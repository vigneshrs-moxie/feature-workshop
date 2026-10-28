// PR feedback (packet N): the read-only gh helpers (lib/git.js), what is new (lib/pr-feedback.js
// findNew and pr-feedback.json) and the card in the driver (lib/driver.js parkFeedbackCard).
// Fixture gh outputs only: no network, no GitHub, no model.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkOf, failedLog, prChecks, prComments } from '../lib/git.js';
import { FEEDBACK_LEAVE, FEEDBACK_SEND, QUOTE_MAX, cardWords, checkKey, feedbackMessage, findNew, lookAt, noteFeedback, ownerOf, readFeedback } from '../lib/pr-feedback.js';
import { Driver } from '../lib/driver.js';
import { JobLocked } from '../lib/lock.js';

const TOKEN = 'orbfb_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

// ---------- A fake gh: fixture answers, every call recorded ----------

const ROLLUP = (head, lint = 'FAILURE') => JSON.stringify({
  headRefOid: head,
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: lint, detailsUrl: 'https://github.com/acme/app/actions/runs/4242/job/77' },
    { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/app/actions/runs/4243/job/78' },
    { __typename: 'StatusContext', context: 'deploy/preview', state: 'PENDING', targetUrl: 'https://example.com/preview' },
  ],
});
const LINE_COMMENTS = JSON.stringify([
  { id: 901, user: { login: 'ana', type: 'User' }, path: 'web/src/App.tsx', line: 40, body: 'Please use a const here.\nAnd name it after what it holds.', html_url: 'https://github.com/acme/app/pull/7#discussion_r901', created_at: '2026-10-27T10:00:00Z' },
  { id: 902, user: { login: 'you', type: 'User' }, path: 'web/src/App.tsx', line: 41, body: 'Note to self.', html_url: 'x', created_at: '2026-10-27T10:01:00Z' },
  { id: 903, user: { login: 'codecov[bot]', type: 'Bot' }, path: null, line: null, body: 'Coverage went down by 0.2%.', html_url: 'y', created_at: '2026-10-27T10:02:00Z' },
]);
const REVIEWS = JSON.stringify([
  { id: 55, user: { login: 'bo', type: 'User' }, body: 'Looks close. One question about the empty state.', state: 'COMMENTED', html_url: 'https://github.com/acme/app/pull/7#pullrequestreview-55', submitted_at: '2026-10-27T11:00:00Z' },
  { id: 56, user: { login: 'bo', type: 'User' }, body: '', state: 'APPROVED', html_url: 'z', submitted_at: '2026-10-27T12:00:00Z' },
]);
const LOG = ['lint\tRun npm run lint\t2026-10-27T10:00:00Z > eslint .', ...Array.from({ length: 100 }, (_, i) => `lint\tRun npm run lint\tline ${i}`), `lint\tRun npm run lint\tleaked ${TOKEN}`, "lint\tRun npm run lint\terror  'x' is assigned a value but never used", 'lint\tRun npm run lint\t##[error]Process completed with exit code 1.', ''].join('\n');

function fakeGh({ head = 'abc111', lint = 'FAILURE' } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    const a = args.join(' ');
    if (a.startsWith('pr view 7 --repo acme/app --json statusCheckRollup,headRefOid')) return { ok: true, out: ROLLUP(head, lint), err: null };
    if (a === 'api --method GET repos/acme/app/pulls/7/comments?per_page=100') return { ok: true, out: LINE_COMMENTS, err: null };
    if (a === 'api --method GET repos/acme/app/pulls/7/reviews?per_page=100') return { ok: true, out: REVIEWS, err: null };
    if (a === 'run view 4242 --repo acme/app --log-failed') return { ok: true, out: LOG, err: null };
    return { ok: false, out: '', err: `unexpected: ${a}` };
  };
  return { gh, calls };
}

// Only reads: gh pr view, gh run view, gh api --method GET.
function onlyReads(calls) {
  for (const args of calls) {
    const ok = (args[0] === 'pr' && args[1] === 'view') || (args[0] === 'run' && args[1] === 'view') || (args[0] === 'api' && args[1] === '--method' && args[2] === 'GET');
    assert.ok(ok, `not a read: gh ${args.join(' ')}`);
    assert.ok(!args.some((x) => /^(-f|-F|--field|--raw-field|--input)$/.test(x)), `sends fields: gh ${args.join(' ')}`);
  }
}

const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });
async function jobDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-prfb-'));
  roots.push(root);
  return root;
}

const JOB = { slug: 'dark-mode', branch: 'feature/dark-mode', closed: null };
const PR = (headSha = 'abc111') => ({ number: 7, label: 'PR #1', head: 'feature/dark-mode', headSha, url: 'https://github.com/acme/app/pull/7' });

// ---------- lib/git.js ----------

test('prChecks reads each check’s name, state, link and run id, and the PR’s newest commit', async () => {
  const { gh, calls } = fakeGh();
  const got = await prChecks('acme/app', 7, { gh });
  assert.equal(got.head, 'abc111');
  assert.deepEqual(got.checks, [
    { name: 'lint', state: 'fail', link: 'https://github.com/acme/app/actions/runs/4242/job/77', runId: '4242' },
    { name: 'test', state: 'pass', link: 'https://github.com/acme/app/actions/runs/4243/job/78', runId: '4243' },
    { name: 'deploy/preview', state: 'pending', link: 'https://example.com/preview', runId: null },
  ]);
  assert.equal(checkOf({ name: 'x', conclusion: 'SKIPPED' }).state, 'skipped');
  onlyReads(calls);
});

test('prComments gives line comments and reviews with a body, oldest first; failedLog the last lines', async () => {
  const { gh, calls } = fakeGh();
  const list = await prComments('acme/app', 7, { gh });
  assert.deepEqual(list.map((c) => [c.id, c.kind, c.author, c.file, c.line]), [
    ['c901', 'line', 'ana', 'web/src/App.tsx', 40], ['c902', 'line', 'you', 'web/src/App.tsx', 41], ['c903', 'line', 'codecov[bot]', null, null], ['r55', 'review', 'bo', null, null],
  ]);
  assert.equal(list[2].bot, true);
  assert.equal(list[0].link, 'https://github.com/acme/app/pull/7#discussion_r901');
  const log = await failedLog('acme/app', '4242', { gh, lines: 3 });
  assert.equal(log.split('\n').length, 3);
  assert.match(log, /exit code 1\.$/);
  assert.equal((await failedLog('acme/app', '4242', { gh })).split('\n').length, 80, '80 lines by default');
  onlyReads(calls);
});

test('the helpers refuse odd names before running gh', async () => {
  const { gh, calls } = fakeGh();
  await assert.rejects(prChecks('acme/app; rm -rf /', 7, { gh }), /repository/);
  await assert.rejects(prChecks('acme/app', -1, { gh }), /pull request number/);
  await assert.rejects(prComments('--repo', 7, { gh }), /repository/);
  await assert.rejects(failedLog('acme/app', '42 --exit', { gh }), /run id/);
  assert.equal(calls.length, 0);
});

// ---------- lib/pr-feedback.js ----------

test('a failed check makes one item, a second refresh none, a failure after a new push a new one', async () => {
  const dir = await jobDir();
  const { gh } = fakeGh();
  const pass = async (gh_) => {
    const record = await readFeedback(dir);
    const checks = await prChecks('acme/app', 7, { gh: gh_ });
    const items = findNew({ job: JOB, pr: PR(checks.head), checks: checks.checks, seen: record.items });
    for (const item of items) await noteFeedback(dir, item.key, { state: 'waiting', item });
    return items;
  };
  const first = await pass(gh);
  assert.deepEqual(first.map((i) => [i.kind, i.name, i.key]), [['check', 'lint', checkKey(PR(), 'lint', 'abc111')]]);
  assert.deepEqual(first[0].pr, { number: 7, label: 'PR #1', url: 'https://github.com/acme/app/pull/7' });
  assert.equal(first[0].runId, '4242');
  assert.deepEqual(await pass(gh), [], 'the same failure on the same commit: nothing new');
  const record = await readFeedback(dir);
  assert.equal(record.items[first[0].key].state, 'waiting');

  const pushed = await pass(fakeGh({ head: 'def222' }).gh);
  assert.equal(pushed.length, 1, 'it fails again after a new push: new');
  assert.equal(pushed[0].key, 'pr7:check:lint@def222');
  assert.deepEqual(await pass(fakeGh({ head: 'def222', lint: 'SUCCESS' }).gh), [], 'a passing check is nothing');
});

test('comments: yours and summary bots are skipped; a closed job and a PR no job owns are left alone', async () => {
  const { gh } = fakeGh();
  const comments = await prComments('acme/app', 7, { gh });
  const items = findNew({ job: JOB, pr: PR(), comments, me: ['You'] });
  assert.deepEqual(items.map((i) => [i.kind, i.author, i.file, i.line]), [['comment', 'ana', 'web/src/App.tsx', 40], ['comment', 'bo', null, null]]);
  assert.deepEqual(findNew({ job: JOB, pr: PR(), comments, seen: new Set(items.map((i) => i.key)), me: 'you' }), []);

  const checks = (await prChecks('acme/app', 7, { gh })).checks;
  assert.deepEqual(findNew({ job: { ...JOB, closed: { as: 'done', at: '2026-10-27T00:00:00Z' } }, pr: PR(), checks, comments }), [], 'closed job');
  const jobs = [{ slug: 'other', branch: 'feature/other' }];
  const stranger = { ...PR(), head: 'feature/someone-elses' };
  assert.equal(ownerOf(stranger, jobs), null, 'no job owns it');
  assert.deepEqual(findNew({ job: jobs[0], pr: stranger, checks, comments }), [], 'and nothing is found for it');
  assert.equal(ownerOf({ head: 'feature/other' }, jobs), jobs[0]);
});

test('the card’s words and the Foreman’s message: quoted, scrubbed, cut to 4,000 characters', async () => {
  const { gh } = fakeGh();
  const [check] = findNew({ job: JOB, pr: PR(), checks: (await prChecks('acme/app', 7, { gh })).checks });
  check.log = await failedLog('acme/app', check.runId, { gh });
  const words = cardWords(check);
  assert.equal(words.headline, 'A check failed on PR #1: lint.');
  assert.match(words.question, /^A check failed on PR #1: lint\. The end of its log: “.*exit code 1\.”\. Send it to the Foreman\?$/);
  assert.ok(!words.question.includes('orbfb_'), words.question);
  assert.ok(!words.question.includes('\t') && !words.question.includes('Run npm run lint'), 'the card quotes the log text, not gh’s job and step columns');

  const msg = feedbackMessage(check);
  assert.ok(msg.startsWith("A check failed on PR #1: lint. The end of its log is below. Fix it on this branch, run the tests, and commit. Don't push.\n\n```\n"), msg.slice(0, 200));
  assert.match(msg, /'x' is assigned a value but never used/);
  assert.match(msg, /\[Orbit token hidden\]/);
  assert.ok(!msg.includes('orbfb_'));
  assert.match(msg, /The check on GitHub: https:\/\/github\.com\/acme\/app\/actions\/runs\/4242\/job\/77$/);

  const [ana] = findNew({ job: JOB, pr: PR(), comments: await prComments('acme/app', 7, { gh }), me: 'you' });
  assert.equal(cardWords(ana).headline, 'ana commented on PR #1, web/src/App.tsx line 40.');
  assert.equal(feedbackMessage(ana), "ana commented on PR #1 at web/src/App.tsx:40:\n\n> Please use a const here.\n> And name it after what it holds.\n\nAnswer it on this branch: change the code, or explain in your reply why not. Don't push, and don't reply on GitHub.\n\nThe comment on GitHub: https://github.com/acme/app/pull/7#discussion_r901");

  const long = { ...check, log: `${'x'.repeat(9000)}\nthe last line` };
  const quoted = /```\n([\s\S]*)\n```/.exec(feedbackMessage(long))[1];
  assert.equal(quoted.length, QUOTE_MAX);
  assert.ok(quoted.endsWith('the last line'), 'a log keeps its end');
  const longComment = { ...ana, body: `${'y'.repeat(5000)} tail` };
  assert.ok(!feedbackMessage(longComment).includes('tail'), 'a comment keeps its start');
  assert.ok(feedbackMessage(longComment, { extra: 'Only the naming, please.' }).startsWith('Only the naming, please.\n\nana commented'));
});

test('the first look at a PR seeds: 5 old comments and 1 failing check give 1 card; a later new comment gives a card', async () => {
  const dir = await jobDir();
  const { driver } = makeDriver();
  const where = { featureDir: dir, slug: 'dark-mode', title: 'Dark mode' };
  const old = Array.from({ length: 5 }, (_, i) => ({ id: `c${100 + i}`, kind: 'line', author: i % 2 ? 'ana' : 'bo', bot: false, file: 'web/src/App.tsx', line: 10 + i, body: `Old comment ${i}.`, link: null, at: `2026-10-20T10:0${i}:00Z` }));
  const checks = [{ name: 'lint', state: 'fail', link: null, runId: '4242' }, { name: 'test', state: 'pass', link: null, runId: '4243' }];
  // What the runner does after a flow refresh: one look, a card for each item.
  const look = async (comments) => {
    const got = await lookAt({ featureDir: dir, job: JOB, pr: PR('abc111'), checks, comments, me: 'you' });
    for (const item of got.items) { await noteFeedback(dir, item.key, { state: 'waiting', item }); driver.parkFeedbackCard(where, item); }
    return got;
  };

  const first = await look(old);
  assert.equal(first.seeded, 5, 'the 5 old comments are seeded');
  assert.deepEqual(first.items.map((i) => [i.kind, i.name]), [['check', 'lint']], 'only the failing check on the newest commit');
  assert.equal(driver.pendingPermissions().length, 1, '1 card');
  const record = await readFeedback(dir);
  assert.deepEqual(Object.entries(record.items).filter(([, v]) => v.state === 'seeded').map(([k]) => k), old.map((c) => `pr7:comment:${c.id}`));
  assert.ok(Object.values(record.items).every((v) => v.state !== 'seeded' || v.item === null), 'no comment body kept for a seeded one');
  assert.equal(record.prs[7].seeded, 5);

  const again = await look(old);
  assert.equal(again.seeded, null, 'a later look is not a first look');
  assert.deepEqual(again.items, []);
  assert.equal(driver.pendingPermissions().length, 1, 'still 1 card');

  const fresh = { id: 'c200', kind: 'line', author: 'ana', bot: false, file: 'web/src/App.tsx', line: 40, body: 'One more thing.', link: null, at: '2026-10-28T09:00:00Z' };
  const later = await look([...old, fresh]);
  assert.deepEqual(later.items.map((i) => [i.kind, i.author, i.key]), [['comment', 'ana', 'pr7:comment:c200']]);
  assert.equal(driver.pendingPermissions().length, 2, 'the new comment gets a card');
  assert.match(driver.pendingPermissions()[1].input.questions[0].question, /^ana commented on PR #1, web\/src\/App\.tsx line 40\. “One more thing\.”/);
});

test('a first look whose comments couldn’t be read waits for one that reads them; a PR seen before isn’t seeded again', async () => {
  const dir = await jobDir();
  const old = [{ id: 'c1', author: 'ana', file: null, line: null, body: 'Old.' }];
  const unread = await lookAt({ featureDir: dir, job: JOB, pr: PR(), checks: [], comments: null });
  assert.deepEqual(unread, { items: [], seeded: null });
  assert.equal((await lookAt({ featureDir: dir, job: JOB, pr: PR(), checks: [], comments: old })).seeded, 1, 'seeded on the look that read them');

  // A record from before the first-look mark: items on that PR already, so it isn't a first look.
  const older = await jobDir();
  await noteFeedback(older, 'pr7:check:lint@abc111', { state: 'sent', item: null });
  const got = await lookAt({ featureDir: older, job: JOB, pr: PR(), checks: [], comments: old });
  assert.equal(got.seeded, null);
  assert.deepEqual(got.items.map((i) => i.key), ['pr7:comment:c1']);
});

// ---------- The card (lib/driver.js) ----------

// A pretend Foreman: replies at once, or waits for `release()` when hold is set.
function makeDriver({ locks = null, session = { sessionId: 'sess-1', slug: 'dark-mode', title: 'Dark mode', cwd: '/repo', model: 'claude-opus-5-5' }, hold = false } = {}) {
  const audits = [];
  const state = { audit: async (e) => { audits.push({ at: new Date().toISOString(), ...e }); }, setSession: async () => {}, sessionFor: async () => null };
  let release = null;
  const queryFn = ({ prompt, options }) => (async function* run() {
    yield { type: 'system', subtype: 'init', session_id: options.resume ?? 'new-session', model: 'claude-opus-5-5' };
    for await (const m of prompt) {
      void m;
      if (hold) await new Promise((r) => { release = () => { release = null; r(); }; });
      yield { type: 'result', total_cost_usd: 0, result: 'Done.' };
      yield { type: 'system', subtype: 'session_state_changed', state: 'idle' };
      break;
    }
  })();
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent', locks, statusWatch: null, feedbackSession: async () => session });
  const events = [];
  driver.on('pr-feedback', (e) => events.push(e));
  // release(): lets the reply that is holding finish (waits until one is holding).
  return { driver, audits, events, release: async () => { await waitFor(() => release, 'a reply holding'); release(); } };
}
const answer = (card, label) => ({ decision: 'allow', answers: { [card.input.questions[0].question]: label } });
const waitFor = async (fn, what) => {
  for (let i = 0; i < 200; i += 1) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error(`Timed out waiting for ${what}`);
};
const JOB_DIR = { featureDir: '/jobs/dark-mode', slug: 'dark-mode', title: 'Dark mode' };
const checkItem = () => ({ key: 'pr7:check:lint@abc111', kind: 'check', pr: { number: 7, label: 'PR #1', url: null }, name: 'lint', link: null, runId: '4242', head: 'abc111', log: `error one\n${TOKEN}\nexit 1` });

test('one card per item, in Needs you; Send resumes the same session with kind pr-feedback, the log quoted and the token hidden', async () => {
  const { driver, audits, events } = makeDriver();
  const card = driver.parkFeedbackCard(JOB_DIR, checkItem());
  driver.parkFeedbackCard(JOB_DIR, checkItem());
  assert.equal(driver.pendingPermissions().length, 1, 'parking it again makes no second card');
  assert.equal(card.kind, 'question');
  assert.equal(card.feedbackCard, true);
  assert.deepEqual(card.input.questions[0].options.map((o) => o.label), [FEEDBACK_SEND, FEEDBACK_LEAVE]);
  assert.ok(!JSON.stringify(card).includes('orbfb_'), 'the card has no token either');

  assert.equal(await driver.decide(card.id, answer(card, FEEDBACK_SEND)), true);
  const send = audits.find((e) => e.action === 'send');
  assert.equal(send.kind, 'pr-feedback');
  assert.equal(send.sessionId, 'sess-1');
  assert.match(send.text, /^A check failed on PR #1: lint\. The end of its log is below\./);
  assert.match(send.text, /error one\n\[Orbit token hidden\]\nexit 1/);
  assert.ok(!send.text.includes('orbfb_'));
  assert.equal(driver.pendingPermissions().length, 0, 'the card is gone');
  assert.deepEqual(events.map((e) => e.outcome), ['sent']);
  assert.equal(events[0].sessionId, 'sess-1');
  await waitFor(() => audits.find((e) => e.action === 'run-ended'), 'the reply to end');
});

test('Leave it sends nothing; Don’t answer the same', async () => {
  const { driver, audits, events } = makeDriver();
  const a = driver.parkFeedbackCard(JOB_DIR, checkItem());
  await driver.decide(a.id, answer(a, FEEDBACK_LEAVE));
  const b = driver.parkFeedbackCard(JOB_DIR, { ...checkItem(), key: 'pr7:comment:c9', kind: 'comment', author: 'ana', file: 'a.js', line: 3, body: 'Hm.' });
  await driver.decide(b.id, { decision: 'deny', note: 'Not now' });
  assert.equal(audits.filter((e) => e.action === 'send').length, 0);
  assert.deepEqual(events.map((e) => [e.outcome, e.item.key]), [['left', 'pr7:check:lint@abc111'], ['left', 'pr7:comment:c9']]);
  assert.equal(driver.pendingPermissions().length, 0);
});

test('a job whose lock is held elsewhere is not resumed: the card stays and says so', async () => {
  const by = { owner: 'terminal', pid: 4321, branch: 'feature/dark-mode', acquiredAt: '2026-10-27T10:00:00Z' };
  const locks = { acquire: () => ({ held: true, by }), release: () => true, branchOf: () => null };
  const { driver, audits, events } = makeDriver({ locks });
  const card = driver.parkFeedbackCard(JOB_DIR, checkItem());
  await assert.rejects(driver.decide(card.id, answer(card, FEEDBACK_SEND)), (err) => err instanceof JobLocked && err.status === 409);
  assert.equal(audits.filter((e) => e.action === 'send').length, 0, 'nothing sent');
  const still = driver.pendingPermissions();
  assert.equal(still.length, 1);
  assert.equal(still[0].id, card.id, 'the same card');
  assert.match(still[0].input.questions[0].question, /Not sent yet: This job is open in a terminal \(pid 4321/);
  assert.deepEqual(events, []);
});

test('while the Foreman is working the message waits, and goes in the same session when the reply ends', async () => {
  const { driver, audits, events, release } = makeDriver({ hold: true });
  await driver.start({ featureDir: JOB_DIR.featureDir, slug: 'dark-mode', title: 'Dark mode', cwd: '/repo', sessionId: 'sess-1', text: 'Carry on.' });
  await waitFor(() => driver.list()[0]?.status === 'running', 'the reply to run');
  const card = driver.parkFeedbackCard(JOB_DIR, checkItem());
  await driver.decide(card.id, answer(card, FEEDBACK_SEND));
  assert.deepEqual(events.map((e) => e.outcome), ['queued']);
  assert.equal(driver.pendingPermissions().length, 0, 'answered: the card is gone while it waits');
  assert.equal(audits.filter((e) => e.action === 'send' && e.kind === 'pr-feedback').length, 0, 'not yet');
  await release();
  const sent = await waitFor(() => audits.find((e) => e.action === 'send' && e.kind === 'pr-feedback'), 'the feedback to go');
  assert.equal(sent.sessionId, 'sess-1');
  assert.deepEqual(events.map((e) => e.outcome), ['queued', 'sent']);
  await release();
  await waitFor(() => audits.filter((e) => e.action === 'run-ended').length === 2, 'both replies to end');
  assert.equal(audits.filter((e) => e.action === 'send' && e.kind === 'pr-feedback').length, 1, 'sent once');
});

test('no session to carry on: nothing is sent, the card stays and says why', async () => {
  const { driver, audits } = makeDriver({ session: { refused: 'This job’s Foreman was last used in your terminal.' } });
  const card = driver.parkFeedbackCard(JOB_DIR, checkItem());
  await assert.rejects(driver.decide(card.id, answer(card, FEEDBACK_SEND)), (err) => err.status === 409 && /Nothing was sent; the card stays\./.test(err.message));
  assert.equal(audits.length, 0);
  assert.match(driver.pendingPermissions()[0].input.questions[0].question, /Not sent yet: This job’s Foreman was last used in your terminal\. Send it to the Foreman\?$/);
});
