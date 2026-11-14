// lib/pr-comments.js (the job page rebuild, Task 21; R3): every comment not answered yet is a row, his own and
// the ones from before Starbase first looked included; each row has who, file and line, the full comment, the
// three code lines it sits on, and a state; Fix these quotes each ticked comment; the Foreman's
// `--- Comments answered ---` block gives each row its commit and drafted reply. gh is faked.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as git from '../lib/git.js';
import {
  answersOf, askMessage, checkMessage, countsOf, createPrComments, fixMessage, hunkLines, linesAround, markCheck, markRows,
  parseCommentsAnswered, readKept, rowsOf, stateWords,
} from '../lib/pr-comments.js';

const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });
async function jobDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-prc-'));
  roots.push(root);
  return root;
}

// GitHub's answers, made up.
const LINE = [
  { id: 901, user: { login: 'ana', type: 'User' }, path: 'web/src/App.tsx', line: 3, original_line: 3, diff_hunk: '@@ -1,3 +1,3 @@\n import x\n-const a = 1\n+let a = 1\n export a', body: 'Please use a const here.\n\nIt never changes.', html_url: 'https://github.com/acme/app/pull/7#discussion_r901', created_at: '2026-11-10T10:00:00Z' },
  { id: 902, user: { login: 'you', type: 'User' }, path: 'web/src/api.ts', line: 12, body: 'My own note: rename this.', html_url: 'https://github.com/acme/app/pull/7#discussion_r902', created_at: '2026-11-10T10:01:00Z' },
  { id: 903, user: { login: 'codecov[bot]', type: 'Bot' }, path: null, line: null, body: 'Coverage 80%', html_url: 'x', created_at: '2026-11-10T10:02:00Z' },
  { id: 904, user: { login: 'you', type: 'User' }, path: 'web/src/App.tsx', line: 3, in_reply_to_id: 901, body: 'Will do.', html_url: 'x', created_at: '2026-11-10T10:03:00Z' },
];
const REVIEWS = [
  { id: 55, user: { login: 'bo', type: 'User' }, state: 'CHANGES_REQUESTED', body: 'A few things before this goes in.', html_url: 'https://github.com/acme/app/pull/7#pullrequestreview-55', submitted_at: '2026-11-10T09:59:00Z' },
  { id: 56, user: { login: 'bo', type: 'User' }, state: 'APPROVED', body: 'Looks good now.', html_url: 'x', submitted_at: '2026-11-10T08:00:00Z' },
];
const ISSUE = [
  { id: 77, user: { login: 'raj', type: 'User' }, body: 'Why does the page run two queries?', html_url: 'https://github.com/acme/app/pull/7#issuecomment-77', created_at: '2026-11-10T10:05:00Z' },
  { id: 78, user: { login: 'vercel[bot]', type: 'Bot' }, body: 'Preview ready', html_url: 'x', created_at: '2026-11-10T10:06:00Z' },
];
const ROLLUP = { headRefOid: 'abc1234def5678abc1234def5678abc1234def56', statusCheckRollup: [
  { name: 'lint', conclusion: 'FAILURE', detailsUrl: 'https://github.com/acme/app/actions/runs/4242/job/9' },
  { name: 'test', conclusion: 'SUCCESS', detailsUrl: 'https://github.com/acme/app/actions/runs/4243/job/9' },
] };
const LOG = 'lint\tRun lint\t> eslint .\nlint\tRun lint\tsrc/a.js: x is unused\nlint\tRun lint\t##[error]Process completed with exit code 1.\n';

function fakeGh({ fail = false } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    const a = args.join(' ');
    if (fail) return { ok: false, out: '', err: 'error connecting to api.github.com' };
    if (a === 'api --method GET repos/acme/app/pulls/7/comments?per_page=100') return { ok: true, out: JSON.stringify(LINE) };
    if (a === 'api --method GET repos/acme/app/pulls/7/reviews?per_page=100') return { ok: true, out: JSON.stringify(REVIEWS) };
    if (a === 'api --method GET repos/acme/app/issues/7/comments?per_page=100') return { ok: true, out: JSON.stringify(ISSUE) };
    if (a === 'api --method GET user') return { ok: true, out: JSON.stringify({ login: 'you' }) };
    if (a === 'pr view 7 --repo acme/app --json statusCheckRollup,headRefOid') return { ok: true, out: JSON.stringify(ROLLUP) };
    if (a === 'run view 4242 --repo acme/app --log-failed') return { ok: true, out: LOG };
    return { ok: false, out: '', err: `not expected: ${a}` };
  };
  return { gh, calls };
}
const onlyReads = (calls) => {
  for (const c of calls) assert.ok((c[0] === 'api' && c[1] === '--method' && c[2] === 'GET') || (c[0] === 'pr' && c[1] === 'view') || (c[0] === 'run' && c[1] === 'view'), `a read: ${c.join(' ')}`);
};
const rowsNow = async (extra = {}) => {
  const { gh } = fakeGh();
  const comments = await git.prComments('acme/app', 7, { gh });
  const conversation = await git.prConversation('acme/app', 7, { gh });
  return rowsOf({ comments, conversation, me: ['you'], number: 7, ...extra });
};

test('git: prConversation reads the PR’s conversation comments; prComments carries each line comment’s thread and each review’s state', async () => {
  const { gh, calls } = fakeGh();
  const conv = await git.prConversation('acme/app', 7, { gh });
  assert.deepEqual(conv.map((c) => [c.id, c.kind, c.author, c.bot]), [['i77', 'conversation', 'raj', false], ['i78', 'conversation', 'vercel[bot]', true]]);
  const list = await git.prComments('acme/app', 7, { gh });
  assert.equal(list.find((c) => c.id === 'c904').replyTo, 'c901');
  assert.equal(list.find((c) => c.id === 'c901').replyTo, null);
  assert.match(list.find((c) => c.id === 'c901').hunk, /^@@/);
  assert.equal(list.find((c) => c.id === 'r55').reviewState, 'CHANGES_REQUESTED');
  await assert.rejects(git.prConversation('--repo', 7, { gh }), /repository/);
  onlyReads(calls);
});

test('rows: every comment not answered yet, his own and the ones from before Starbase first looked included; bots and approvals left out', async () => {
  const rows = await rowsNow();
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.author, r.mine, r.state]), [
    ['r55', 'review', 'bo', false, 'new'],
    ['c901', 'line', 'ana', false, 'new'],
    ['c902', 'line', 'you', true, 'new'],
    ['i77', 'conversation', 'raj', false, 'new'],
  ]);
  const c901 = rows.find((r) => r.id === 'c901');
  assert.equal(c901.file, 'web/src/App.tsx');
  assert.equal(c901.line, 3);
  assert.equal(c901.body, 'Please use a const here.\n\nIt never changes.', 'the full comment');
  assert.deepEqual(c901.replies.map((x) => [x.author, x.mine, x.body]), [['you', true, 'Will do.']], 'a thread is one row; his reply in it answers nothing');
  assert.deepEqual(c901.context, ['import x', 'let a = 1', 'export a'], 'no worktree: the lines from GitHub’s hunk');
  assert.deepEqual(countsOf(rows), { fresh: 4, total: 4, fixed: 0 });
});

test('rows: the three code lines come from the PR’s head when the worktree has it', async () => {
  const around = linesAround('one\ntwo\nthree\nfour\n', 3);
  assert.deepEqual(around, { at: 2, lines: ['two', 'three', 'four'] });
  assert.deepEqual(linesAround('one\ntwo', 1), { at: 1, lines: ['one', 'two'] });
  assert.equal(linesAround('one', 5), null);
  const rows = await rowsNow({ context: new Map([['c901', around]]) });
  const c901 = rows.find((r) => r.id === 'c901');
  assert.deepEqual(c901.context, ['two', 'three', 'four']);
  assert.equal(c901.contextAt, 2);
  assert.deepEqual(hunkLines('@@ -1 +1 @@\n a\n-b\n+c'), ['a', 'c']);
});

test('states in words: New, Fixing, Fixed in abc1234, Answered, Left', () => {
  assert.equal(stateWords({ state: 'new' }), 'New');
  assert.equal(stateWords({ state: 'fixing' }), 'Fixing');
  assert.equal(stateWords({ state: 'fixed', commit: 'abc1234def' }), 'Fixed in abc1234');
  assert.equal(stateWords({ state: 'answered' }), 'Answered');
  assert.equal(stateWords({ state: 'left' }), 'Left');
});

const ANSWER = [
  'Done: the three comments.',
  '',
  '--- Comments answered ---',
  'c901 · fixed in a1b2c3d · reply: Fixed in a1b2c3d: it is a `const` now.',
  'i77 · answered · reply: It’s only called from the job page, so the extra query runs once per load · twice at most.',
  'c902 · left · the helper is shared with the Jobs list · reply: Kept as it is: the helper is shared.',
  'not a line',
  '--- End ---',
].join('\n');

test('the Foreman’s block: each comment’s commit or outcome and its drafted reply; strict about the fences', () => {
  assert.deepEqual(parseCommentsAnswered(ANSWER), [
    { id: 'c901', state: 'fixed', commit: 'a1b2c3d', why: null, reply: 'Fixed in a1b2c3d: it is a `const` now.' },
    { id: 'i77', state: 'answered', commit: null, why: null, reply: 'It’s only called from the job page, so the extra query runs once per load · twice at most.' },
    { id: 'c902', state: 'left', commit: null, why: 'the helper is shared with the Jobs list', reply: 'Kept as it is: the helper is shared.' },
  ]);
  assert.deepEqual(parseCommentsAnswered(ANSWER.replace('--- Comments answered ---', '-- Comments answered --')), [], 'a fence not spelt exactly: no block');
  assert.deepEqual(parseCommentsAnswered(ANSWER.replace('--- End ---', '')), [], 'no end: no block');
  assert.deepEqual(parseCommentsAnswered(`--- Comments answered ---\nc1 · fixed in a1b2c3d · reply: old\n--- End ---\n\n${ANSWER}`).map((a) => a.id), ['c901', 'i77', 'c902'], 'the last block');
  // With a notes block after it (both end with --- End ---).
  const both = `${ANSWER}\n\n--- Notes answered ---\n1. done · Plan v3 · step 4 removed\n--- End ---`;
  assert.equal(parseCommentsAnswered(both).length, 3);
});

test('rows after the Foreman: Fixed in its commit with the drafted reply; a reviewer’s later reply opens it again; his own later comment does not', async () => {
  const thread = [
    { kind: 'you', at: '2026-11-10T11:00:00Z', text: 'Fix these' },
    { kind: 'reply', at: '2026-11-10T11:30:00Z', reply: ANSWER },
  ];
  const answers = answersOf(thread);
  let rows = await rowsNow({ answers });
  const c901 = rows.find((r) => r.id === 'c901');
  assert.equal(c901.state, 'fixed');
  assert.equal(c901.commit, 'a1b2c3d');
  assert.equal(stateWords(c901), 'Fixed in a1b2c3d');
  assert.deepEqual(c901.reply, { draft: 'Fixed in a1b2c3d: it is a `const` now.', posted: null });
  assert.equal(rows.find((r) => r.id === 'i77').state, 'answered');
  assert.equal(rows.find((r) => r.id === 'c902').state, 'left');
  assert.equal(rows.find((r) => r.id === 'c902').why, 'the helper is shared with the Jobs list');
  assert.equal(rows.find((r) => r.id === 'r55').state, 'new', 'not in the block: still new');
  assert.deepEqual(countsOf(rows), { fresh: 1, total: 4, fixed: 1 });

  const { gh } = fakeGh();
  const comments = await git.prComments('acme/app', 7, { gh });
  const later = (author, at) => ({ id: 'c999', kind: 'line', author, file: 'web/src/App.tsx', line: 3, body: 'Hm, not quite.', at, replyTo: 'c901' });
  rows = rowsOf({ comments: [...comments, later('ana', '2026-11-10T12:00:00Z')], me: ['you'], answers });
  assert.equal(rows.find((r) => r.id === 'c901').state, 'new', 'the reviewer replied after the answer');
  rows = rowsOf({ comments: [...comments, later('you', '2026-11-10T12:00:00Z')], me: ['you'], answers });
  assert.equal(rows.find((r) => r.id === 'c901').state, 'fixed', 'his own later reply answers nothing and opens nothing');
  // His own row stays a row whatever he writes later.
  rows = rowsOf({ comments, conversation: [{ id: 'i80', kind: 'conversation', author: 'you', body: 'All done here.', at: '2026-11-10T13:00:00Z' }], me: ['you'] });
  assert.equal(rows.find((r) => r.id === 'c902').state, 'new');
});

test('rows: his marks (Fix these, Leave, Post it) and a review round’s items mark a row; the newest wins', async () => {
  const kept = { c901: { state: 'fixing', at: '2026-11-10T11:00:00Z' }, i77: { state: 'left', at: '2026-11-10T11:00:00Z' } };
  let rows = await rowsNow({ kept });
  assert.equal(rows.find((r) => r.id === 'c901').state, 'fixing');
  assert.equal(stateWords(rows.find((r) => r.id === 'c901')), 'Fixing');
  assert.equal(rows.find((r) => r.id === 'i77').state, 'left');
  // The Foreman answers after his Fix these: the answer is newer.
  rows = await rowsNow({ kept, answers: answersOf([{ kind: 'reply', at: '2026-11-10T11:30:00Z', reply: ANSWER }]) });
  assert.equal(rows.find((r) => r.id === 'c901').state, 'fixed');
  // Posted: his mark with the reply he posted is newer still.
  rows = await rowsNow({ kept: { c901: { state: 'fixed', commit: 'a1b2c3d', reply: { draft: 'Done.', posted: 'Done.' }, at: '2026-11-10T11:40:00Z' } }, answers: answersOf([{ kind: 'reply', at: '2026-11-10T11:30:00Z', reply: ANSWER }]) });
  assert.deepEqual(rows.find((r) => r.id === 'c901').reply, { draft: 'Done.', posted: 'Done.' });
  // A review round's item (lib/review-round.js) marks it too.
  rows = await rowsNow({ rounds: new Map([['r55', { id: 'r55', state: 'fixed', commit: 'fedcba9876', reply: 'Done in fedcba9.', at: '2026-11-10T10:30:00Z' }]]) });
  assert.equal(rows.find((r) => r.id === 'r55').state, 'fixed');
  assert.equal(rows.find((r) => r.id === 'r55').commit, 'fedcba9');
});

test('Fix these quotes each ticked comment (id, file, line, words); What is he asking? asks for words only; Fix it carries the failing lines', async () => {
  const rows = (await rowsNow()).filter((r) => ['c901', 'i77'].includes(r.id));
  const text = fixMessage(rows, { label: 'PR #1', number: 7 });
  assert.match(text, /^Please fix these 2 review comments on PR #1 \(#7\) on this branch, one commit per comment\. Don't push, and don't reply/);
  assert.match(text, /--- Comments answered ---/);
  assert.ok(text.includes('--- PR comments (2) ---\nc901 · web/src/App.tsx line 3 · ana\n   > Please use a const here.\n   >\n   > It never changes.\n   you replied:\n     > Will do.\ni77 · conversation · raj\n   > Why does the page run two queries?\n--- End of PR comments ---'), text);
  const ask = askMessage(rows.slice(0, 1), { label: 'PR #1', number: 7 });
  assert.match(ask, /^What is this review comment on PR #1 \(#7\) asking for\?/);
  assert.match(ask, /Change nothing yet/);
  const fix = checkMessage({ name: 'lint', log: 'src/a.js: x is unused', link: 'https://github.com/acme/app/actions/runs/4242' }, { label: 'PR #1', number: 7 });
  assert.match(fix, /A check failed on PR #1 \(#7\): lint\./);
  assert.match(fix, /src\/a\.js: x is unused/);
  assert.match(fix, /Don't push/);
});

test('pr-comments.json keeps only the marks: Fix these marks rows Fixing, Fix it marks a check', async () => {
  const dir = await jobDir();
  assert.deepEqual(await readKept(dir), { prs: {}, readAt: null });
  await markRows(dir, 7, { c901: { state: 'fixing' }, i77: { state: 'fixing' } }, '2026-11-10T11:00:00Z');
  await markCheck(dir, 7, { name: 'lint', head: 'abc1234' }, 'fixing', '2026-11-10T11:00:00Z');
  const kept = await readKept(dir);
  assert.deepEqual(Object.keys(kept.prs['7'].rows), ['c901', 'i77']);
  assert.equal(kept.prs['7'].rows.c901.state, 'fixing');
  assert.equal(kept.prs['7'].checks['lint@abc1234'].state, 'fixing');
  assert.ok(!JSON.stringify(kept).includes('Please use a const'), 'no comment text kept');
});

const VIEW = {
  repos: [{ prsKnown: true, org: { slug: 'acme/app', remote: 'org' }, fork: { slug: 'you/app', remote: 'origin' },
    lanes: [
      { slug: 'open-job', branch: 'feature/x', pr1: { number: 7, state: 'open', url: 'https://github.com/acme/app/pull/7', head: 'feature/x' } },
      { slug: 'not-open', branch: 'feature/y', pr1: { number: 8, state: 'open' } },
    ] }],
};

test('the read: after a network refresh, only the jobs the new page has; each line comment’s three code lines from the PR’s head; a failed check’s failing lines', async () => {
  const dir = await jobDir();
  const { gh, calls } = fakeGh();
  const touched = [];
  const reads = [];
  const comments = createPrComments({
    gh, git,
    read: async (d, args) => { reads.push(args); return args[0] === 'cat-file' && args[2].endsWith(':web/src/App.tsx') ? { ok: true, out: 'import x\nimport y\nlet a = 1\nexport a\n' } : { ok: false, out: '' }; },
    jobs: async () => [{ slug: 'open-job', dir }, { slug: 'not-open', dir: '/nowhere' }],
    wanted: (slug) => slug === 'open-job', codeDir: () => '/work/tree', touch: (s) => touched.push(s), rounds: async () => [],
  });
  await comments.pass(VIEW);
  assert.deepEqual(touched, ['open-job']);
  assert.ok(!calls.some((c) => c.join(' ').includes('pulls/8')), 'a job the page does not have is not read');
  onlyReads(calls);
  assert.ok(reads.every((a) => a[0] === 'cat-file' && a[1] === '-p'), 'git: only cat-file -p');
  assert.ok(reads.some((a) => a[2] === `${ROLLUP.headRefOid}:web/src/App.tsx`), 'the file at the PR’s head');
  const facts = await comments.factsOf({ slug: 'open-job', dir }, []);
  const pr = facts[1];
  assert.equal(pr.number, 7);
  assert.deepEqual(pr.rows.map((r) => r.id), ['r55', 'c901', 'c902', 'i77']);
  assert.deepEqual(pr.rows.find((r) => r.id === 'c901').context, ['import y', 'let a = 1', 'export a']);
  assert.equal(pr.rows.find((r) => r.id === 'c902').mine, true, 'his gh login');
  assert.equal(pr.fresh, 4);
  assert.deepEqual(pr.checks.map((c) => [c.name, c.state]), [['lint', 'failed']]);
  assert.match(pr.checks[0].log, /x is unused/);
  assert.equal(pr.verdict.state, 'changes_requested');
  assert.equal(pr.verdict.by, 'bo');
  assert.ok(pr.readAt);
  assert.ok((await readKept(dir)).readAt, 'when it was read, kept');
  // Fix it marks the check.
  await markCheck(dir, 7, pr.checks[0], 'fixing');
  assert.equal((await comments.factsOf({ slug: 'open-job', dir }, []))[1].checks[0].state, 'fixing');
});

test('the read: GitHub not answering keeps what was read and says so', async () => {
  const dir = await jobDir();
  let fail = false;
  const ok = fakeGh();
  const bad = fakeGh({ fail: true });
  const comments = createPrComments({
    gh: (a) => (fail ? bad.gh(a) : ok.gh(a)), git, read: async () => ({ ok: false, out: '' }),
    jobs: async () => [{ slug: 'open-job', dir }], wanted: () => true, codeDir: () => null, touch: () => {}, rounds: async () => [],
  });
  await comments.pass(VIEW);
  fail = true;
  await comments.pass(VIEW);
  const pr = (await comments.factsOf({ slug: 'open-job', dir }, []))[1];
  assert.equal(pr.rows.length, 4, 'the rows last read stay');
  assert.match(pr.problem, /^GitHub couldn’t be read: /);
});
