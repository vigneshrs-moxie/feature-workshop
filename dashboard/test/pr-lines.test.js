// The job page's PR lines (lib/pr-lines.js; the job page rebuild, Task 20, R2): each of PR #1, #2 and
// #3 with its state from GitHub and at most one next action, what that action will send and push, and
// no button when GitHub is not there. GitHub is a pretend `gh pr list` answer read through the flow
// map's own parsing (lib/flow.js prOf, laneOf); git is a pretend runner. Nothing real is read or written.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { laneOf, prOf, githubProblem } from '../lib/flow.js';
import { prRows } from '../lib/job-page.js';
import { nudgesFor } from '../lib/nudges.js';
import { mergedToTell, prLines, PR_SENTENCES, readDue, READ_MAX_AGE_MS, tellMerges, unpushedOf } from '../lib/pr-lines.js';

const BRANCH = 'feature/orbit-9-damage-list';
const ORG = { remote: 'moxie', slug: 'acme/portal' };
const FORK = { remote: 'origin', slug: 'you/portal-fork' };
const READ_AT = '2026-11-14T14:00:00.000Z';
const GITHUB = { checkedAt: READ_AT, triedAt: READ_AT, checking: false, problem: null };
const C = (sha, subject) => ({ sha: sha.padEnd(40, '0'), short: sha.slice(0, 7), subject });
const TWO = [C('bbbbbbb1', 'Show the damage list'), C('aaaaaaa1', 'Add the damage table')];

// gh pr list's JSON, as GitHub answers it.
const gh = (number, base, state, extra = {}) => ({
  number, title: extra.title ?? 'ORBIT-9: Damage list', state, isDraft: false, headRefName: BRANCH, baseRefName: base,
  headRepositoryOwner: { login: base === BRANCH ? 'you' : 'acme' }, url: `https://github.com/acme/portal/pull/${number}`,
  reviewDecision: extra.review ?? null, mergedAt: extra.mergedAt ?? null, mergeCommit: extra.mergeCommit ? { oid: extra.mergeCommit } : null,
  statusCheckRollup: extra.checks ?? [], updatedAt: '2026-11-14T13:00:00Z', createdAt: extra.createdAt ?? '2026-11-14T12:00:00Z',
});
// The job's lane, placed from those PRs the way the flow map places it.
const laneFrom = (list, jf = {}) => laneOf({ slug: 'x', title: 'X' }, {
  branch: BRANCH, fork: { exists: false }, org: { exists: false }, ...jf,
}, { org: { slug: ORG.slug }, fork: { owner: 'you' }, staging: { ref: 'moxie/staging' }, prs: list.map(prOf), inMain: {} });

/** The facts the runner hands prLines, for one moment of the job. */
function facts({ list = [], jf = {}, push = { pushed: false, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 }, stage = 'review', status = [], github = GITHUB, ...over } = {}) {
  const lane = laneFrom(list, jf);
  return {
    rows: prRows(status, lane), lane, repo: { org: ORG, fork: FORK }, github, push,
    job: { slug: 'x', stage, prs: status, closed: null, title: 'ORBIT-9: Damage list', key: 'ORBIT-9' },
    sent: [], dismissed: [], inRound: false, pending: [], hosted: false, covered: true, ...over,
  };
}
const line = (f, n) => prLines(f).lines[n - 1];

test('pr lines: PR #1 not open, with commits → Push and open PR #1, saying every commit, where from and to, and the title', () => {
  const l = line(facts(), 1);
  assert.equal(l.state, 'not-started');
  assert.equal(l.word, 'not open');
  assert.equal(l.next.id, 'push-open');
  assert.equal(l.next.label, 'Push and open PR #1');
  assert.equal(l.next.go, 'Push and open');
  assert.deepEqual(l.next.says, [
    `Pushes 2 commits from ${BRANCH} to your fork (origin):`,
    'bbbbbbb Show the damage list',
    'aaaaaaa Add the damage table',
    `Opens PR #1: you:${BRANCH} → ${BRANCH} on acme/portal`,
    'Title: ORBIT-9: Damage list',
    `${BRANCH} isn’t on acme/portal yet: the Foreman makes it from main first.`,
  ]);
  assert.equal(l.next.sends, PR_SENTENCES['push-open']({ branch: BRANCH, fork: 'origin', forkOwner: 'you', org: 'acme/portal', head: 'bbbbbbb', headFull: TWO[0].sha, count: 2, title: 'ORBIT-9: Damage list', orgBranch: false }));
  assert.match(l.next.sends, /^Please push feature\/orbit-9-damage-list to origin as it is now \(2 commits, ending at bbbbbbb\), with exactly that commit: `git push origin bbbbbbb10{32}:refs\/heads\/feature\/orbit-9-damage-list`\. Then open PR #1/);
  assert.match(l.next.sends, /Nothing else goes to GitHub\./);
  assert.match(l.next.check, /^[0-9a-f]{12}$/);
  // PR #2 and PR #3 wait for the one before: no button, and they say what for.
  assert.equal(line(facts(), 2).next, null);
  assert.equal(line(facts(), 2).why, 'after PR #1 is merged');
  assert.equal(line(facts(), 3).next, null);
  assert.equal(line(facts(), 3).why, 'after PR #2 is merged');
});

test('pr lines: the branch already on the fork with nothing new → Open PR #1, pushing nothing; no commits at all → no button', () => {
  const up = facts({ jf: { fork: { exists: true, ahead: 0, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 } });
  const l = line(up, 1);
  assert.equal(l.next.id, 'open-pr1');
  assert.equal(l.next.label, 'Open PR #1');
  assert.deepEqual(l.next.says, [`Pushes nothing: ${BRANCH} is on your fork (origin) at bbbbbbb.`, `Opens PR #1: you:${BRANCH} → ${BRANCH} on acme/portal`, 'Title: ORBIT-9: Damage list']);
  const none = line(facts({ push: { pushed: false, head: TWO[0].sha, count: 0, commits: [], behind: 0 } }), 1);
  assert.equal(none.next, null);
  assert.equal(none.why, 'No commits yet');
});

test('pr lines: PR #1 open with 2 commits not pushed → Push update (2 commits); open and pushed → no button', () => {
  const list = [gh(247, BRANCH, 'OPEN', { checks: [{ conclusion: 'SUCCESS' }] })];
  const f = facts({ list, jf: { fork: { exists: true, ahead: 2, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 }, stage: 'pr1' });
  const l = line(f, 1);
  assert.equal(l.state, 'open');
  assert.equal(l.number, 247);
  assert.equal(l.word, 'open · checks passed');
  assert.equal(l.at, '2026-11-14T12:00:00Z', 'when it was opened');
  assert.equal(l.next.label, 'Push update (2 commits)');
  assert.equal(l.next.go, 'Push');
  assert.deepEqual(l.next.says, [`Pushes 2 commits from ${BRANCH} to your fork (origin), so PR #1 (#247) has them:`, 'bbbbbbb Show the damage list', 'aaaaaaa Add the damage table']);
  assert.match(l.next.sends, /^Please push feature\/orbit-9-damage-list to origin as it is now: 2 commits PR #1 \(#247\) doesn’t have yet, ending at bbbbbbb\. Push exactly that commit: `git push origin bbbbbbb10{32}:refs\/heads\/feature\/orbit-9-damage-list`\. Only this push: nothing else goes to GitHub\.$/);
  const one = line(facts({ list, jf: { fork: { exists: true, ahead: 1, behind: 0 } }, push: { pushed: true, head: TWO[0].sha, count: 1, commits: [TWO[0]], behind: 0 }, stage: 'pr1' }), 1);
  assert.equal(one.next.label, 'Push update (1 commit)');
  const clean = line(facts({ list, jf: { fork: { exists: true, ahead: 0, behind: 0 } }, push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 }, stage: 'pr1' }), 1);
  assert.equal(clean.next, null, 'nothing to push: merging stays his, on GitHub');
  assert.equal(clean.url, 'https://github.com/acme/portal/pull/247');
});

test('pr lines: PR #1 merged → no button, with when; PR #2 → Open PR #2 only once PR #1 merged and the Foreman has it', () => {
  const merged = [gh(247, BRANCH, 'MERGED', { mergedAt: '2026-11-14T14:02:00Z' })];
  const told = facts({ list: merged, jf: { fork: { exists: true, ahead: 0, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 }, stage: 'pr2', status: [{ number: 1, state: 'merged' }] });
  const l1 = line(told, 1);
  assert.equal(l1.state, 'merged');
  assert.equal(l1.at, '2026-11-14T14:02:00Z');
  assert.equal(l1.next, null);
  const l2 = line(told, 2);
  assert.equal(l2.state, 'not-started');
  assert.equal(l2.next.id, 'open-pr2');
  assert.equal(l2.next.label, 'Open PR #2');
  assert.deepEqual(l2.next.says, [`Opens PR #2: ${BRANCH} on acme/portal → staging`, 'Title: ORBIT-9: Damage list', 'Pushes nothing: PR #2 carries what PR #1 merged.', 'Starbase will ask you once more when the Foreman opens the PR.'], 'a PR into staging is never covered by the go-ahead');
  assert.match(l2.next.sends, /^Please open PR #2 \(org branch → staging\)\. From feature\/orbit-9-damage-list into staging on acme\/portal, titled "ORBIT-9: Damage list"\./, 'the nudge’s own sentence first');
  // Merged on GitHub, but the Foreman (still at pr1, status.json not merged) hasn't been told: no Open PR #2 yet.
  const untold = facts({ list: merged, jf: { fork: { exists: true, ahead: 0, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 }, stage: 'pr1', status: [{ number: 1, state: 'open' }] });
  assert.equal(line(untold, 2).next, null);
  // PR #1 still open: PR #2 waits.
  const open = facts({ list: [gh(247, BRANCH, 'OPEN')], stage: 'pr1', push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 } });
  assert.equal(line(open, 2).next, null);
  assert.equal(line(open, 2).why, 'after PR #1 is merged');
});

test('pr lines: PR #2 open → Request review, the nudge’s sentence; sent once, it says so and has no button', () => {
  const list = [gh(247, BRANCH, 'MERGED', { mergedAt: '2026-11-14T14:02:00Z' }), gh(248, 'staging', 'OPEN', { review: 'REVIEW_REQUIRED' })];
  const base = { list, jf: { fork: { exists: true, ahead: 0, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 }, stage: 'pr2', status: [{ number: 1, state: 'merged' }, { number: 2, state: 'open' }] };
  const l = line(facts(base), 2);
  assert.equal(l.state, 'open');
  assert.equal(l.number, 248);
  assert.equal(l.next.id, 'request-review');
  assert.equal(l.next.label, 'Request review');
  assert.equal(l.next.sends, 'Please request Raj’s review on PR #2.');
  assert.equal(l.next.sends, nudgesFor({ stage: 'pr2', prs: base.status, closed: null, finish: { reached: false } }, laneFrom(list, base.jf)).find((n) => n.id === 'pr2-review').action.send);
  assert.deepEqual(l.next.says, ['Asks Raj to review PR #2 (#248).', 'Pushes nothing.']);
  const sent = line(facts({ ...base, sent: ['pr2-review'] }), 2);
  assert.equal(sent.next, null);
  assert.equal(sent.why, 'Sent to the Foreman');
  // Approved: nothing to ask.
  const approved = line(facts({ ...base, list: [list[0], gh(248, 'staging', 'OPEN', { review: 'APPROVED' })] }), 2);
  assert.equal(approved.next, null);
});

test('pr lines: a sentence already sent and still on its way gives no second button', () => {
  const f = facts();
  const first = line(f, 1);
  // Pending is keyed by the action and its commit (Phase 4 B2), not by the words.
  const again = line({ ...f, pending: [first.next.key] }, 1);
  assert.equal(again.next, null);
  assert.equal(again.why, 'Sent to the Foreman');
  // The branch moved (a new commit): another sentence, so a button again.
  const moved = line({ ...f, pending: [first.next.key], push: { ...f.push, head: 'ccccccc1'.padEnd(40, '0'), count: 3, commits: [C('ccccccc1', 'More'), ...TWO] } }, 1);
  assert.equal(moved.next.label, 'Push and open PR #1');
  assert.notEqual(moved.next.check, first.next.check);
});

test('pr lines: GitHub signed out, unreachable or never read → the lines say what is known and when, with no button', () => {
  const signedOut = githubProblem('gh pr list: To get started with GitHub CLI, please run:  gh auth login');
  const out = prLines(facts({ github: { checkedAt: READ_AT, triedAt: '2026-11-14T14:10:00Z', checking: false, problem: signedOut } }));
  assert.ok(out.lines.every((l) => l.next === null));
  assert.equal(out.lines[0].why, 'No button while GitHub isn’t answering');
  assert.deepEqual(out.github, { at: READ_AT, triedAt: '2026-11-14T14:10:00Z', reading: false, problem: 'GitHub didn’t answer. gh isn’t signed in: run gh auth login', run: 'gh auth login' });
  const offline = prLines(facts({ github: { checkedAt: null, triedAt: '2026-11-14T14:10:00Z', checking: false, problem: githubProblem('gh pr list: dial tcp: lookup api.github.com: network is unreachable') } }));
  assert.ok(offline.lines.every((l) => l.next === null));
  assert.match(offline.github.problem, /network looks down/);
  const never = prLines(facts({ github: { checkedAt: null, triedAt: null, checking: true, problem: null } }));
  assert.ok(never.lines.every((l) => l.next === null));
  assert.equal(never.lines[0].why, 'GitHub not read yet');
  assert.equal(never.github.reading, true);
  // No GitHub line at all (an older runner, the website's copy): nothing to act on.
  const none = prLines({ rows: prRows([], null) });
  assert.ok(none.lines.every((l) => l.next === null));
  assert.deepEqual(none.lines.map((l) => l.why), [null, 'after PR #1 is merged', 'after PR #2 is merged'], 'only what each waits for');
  assert.equal(none.github, null);
});

test('pr lines: no button that cannot work: the fork ahead of the branch, a closed job, the website, an unknown fork', () => {
  const behind = line(facts({ push: { pushed: true, head: TWO[0].sha, count: 2, commits: TWO, behind: 1 }, jf: { fork: { exists: true, ahead: 2, behind: 1 } } }), 1);
  assert.equal(behind.next, null);
  assert.equal(behind.why, 'Your fork has 1 commit this branch doesn’t: a push would be refused. Ask the Foreman to bring it in first.');
  const closed = facts();
  closed.job = { ...closed.job, closed: { as: 'done', at: READ_AT } };
  assert.equal(line(closed, 1).next, null);
  assert.ok(prLines(facts({ hosted: true })).lines.every((l) => l.next === null));
  assert.ok(prLines(facts({ repo: { org: ORG, fork: null } })).lines.every((l) => l.next === null));
  assert.equal(line(facts({ push: null }), 1).next, null, 'the branch’s commits unknown');
});

test('pr lines: a PR opened, reviewed or merged by hand shows as GitHub has it', () => {
  // Opened by hand on GitHub while status.json still says not started.
  const opened = line(facts({ list: [gh(250, BRANCH, 'OPEN')], status: [{ number: 1, state: 'not_started' }], push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 } }), 1);
  assert.equal(opened.state, 'open');
  assert.equal(opened.number, 250);
  const reviewed = line(facts({ list: [gh(247, BRANCH, 'MERGED'), gh(248, 'staging', 'OPEN', { review: 'CHANGES_REQUESTED' })], stage: 'pr2', status: [{ number: 1, state: 'merged' }] }), 2);
  assert.equal(reviewed.word, 'open · changes asked');
  assert.equal(reviewed.next, null, 'changes asked: the comments come first (Task 21)');
});

test('pr lines: a merge by hand the Foreman hasn’t seen is told with the nudge’s own sentence, once', () => {
  const merged = [gh(247, BRANCH, 'MERGED', { mergedAt: '2026-11-14T14:02:00Z' })];
  const lane = laneFrom(merged, { fork: { exists: true }, org: { exists: true } });
  const card = { stage: 'pr1', prs: [{ number: 1, state: 'open' }], closed: null };
  const tell = mergedToTell({ card, lane });
  assert.deepEqual(tell.map((t) => t.id), ['pr1-merged']);
  assert.equal(tell[0].text, 'PR #1 (#247) is already merged on GitHub (Starbase just checked). Update status.json and carry on from there; don\'t ask me to merge it.');
  assert.equal(tell[0].text, nudgesFor({ ...card, finish: { reached: false } }, lane).find((n) => n.id === 'pr1-merged').action.send);
  assert.deepEqual(mergedToTell({ card, lane, sent: ['pr1-merged'] }), [], 'already told');
  assert.deepEqual(mergedToTell({ card, lane, dismissed: ['pr1-merged'] }), [], 'he set it aside on the Desk');
  assert.deepEqual(mergedToTell({ card: { ...card, prs: [{ number: 1, state: 'merged' }], stage: 'pr2' }, lane }), [], 'the Foreman already has it');
  assert.deepEqual(mergedToTell({ card: { ...card, closed: { as: 'done' } }, lane }), [], 'a closed job is told nothing');
});

test('pr lines: GitHub is read when the last read is older than two minutes, never while a read is going', () => {
  const now = Date.parse('2026-11-14T14:10:00Z');
  assert.equal(READ_MAX_AGE_MS, 120000);
  assert.equal(readDue({ triedAt: null, checking: false }, now), true);
  assert.equal(readDue({ triedAt: '2026-11-14T14:07:59Z', checking: false }, now), true);
  assert.equal(readDue({ triedAt: '2026-11-14T14:08:30Z', checking: false }, now), false);
  assert.equal(readDue({ triedAt: null, checking: true }, now), false);
  assert.equal(readDue(null, now), true);
});

// ---------- the branch's commits (git, pretend) ----------

/** A pretend git: answers by the command, and keeps every command it was asked. */
function fakeGit(answers) {
  const calls = [];
  const git = async (dir, args) => {
    calls.push(args);
    const key = args.join(' ');
    for (const [match, res] of answers) if (key.includes(match)) return typeof res === 'string' ? { ok: true, out: res, err: null } : res;
    return { ok: false, out: '', err: 'no such ref' };
  };
  return { git, calls };
}
const LOG = (cs) => cs.map((c) => `${c.sha}\x1f${c.short}\x1f${c.subject}\x1e`).join('\n');

test('pr lines: unpushedOf lists the commits the fork lacks, newest first, with read-only git', async () => {
  const { git, calls } = fakeGit([
    [`--verify --quiet refs/remotes/origin/${BRANCH}^{commit}`, 'f'.repeat(40)],
    [`--verify --quiet refs/heads/${BRANCH}^{commit}`, `${TWO[0].sha}\n`],
    [`rev-list --count refs/remotes/origin/${BRANCH}..refs/heads/${BRANCH}`, '2\n'],
    [`rev-list --count refs/heads/${BRANCH}..refs/remotes/origin/${BRANCH}`, '0\n'],
    [`refs/remotes/origin/${BRANCH}..refs/heads/${BRANCH}`, LOG(TWO)],
  ]);
  const out = await unpushedOf({ dir: '/r/wt', branch: BRANCH, base: 'abc1234', fork: 'origin', git });
  assert.deepEqual(out, { pushed: true, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 });
  assert.ok(calls.every((a) => ['rev-parse', 'rev-list', 'log'].includes(a[0])), 'only reads');
});

test('pr lines: unpushedOf on a branch never pushed lists base..branch; a bad name or no branch reads nothing', async () => {
  const { git } = fakeGit([
    [`--verify --quiet refs/heads/${BRANCH}^{commit}`, `${TWO[0].sha}\n`],
    [`rev-list --count abc1234..refs/heads/${BRANCH}`, '2\n'],
    [`abc1234..refs/heads/${BRANCH}`, LOG(TWO)],
  ]);
  assert.deepEqual(await unpushedOf({ dir: '/r/wt', branch: BRANCH, base: 'abc1234', fork: 'origin', git }), { pushed: false, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 });
  assert.equal(await unpushedOf({ dir: '/r/wt', branch: BRANCH, base: null, fork: 'origin', git }), null, 'no base: what would go isn’t known');
  const { git: none, calls } = fakeGit([]);
  assert.equal(await unpushedOf({ dir: '/r/wt', branch: '-x', base: 'abc', fork: 'origin', git: none }), null);
  assert.equal(await unpushedOf({ dir: '/r/wt', branch: BRANCH, base: 'abc', fork: 'origin; rm', git: none }), null);
  assert.equal(calls.length, 0, 'a bad name runs nothing');
  assert.equal(await unpushedOf({ dir: '/r/wt', branch: BRANCH, base: 'abc', fork: 'origin', git: none }), null, 'no such branch');
});

test('fix round 1: where the PR steps’ go-ahead won’t cover it (not auto mode, or before a PR step), says ends by telling him he will be asked once more', () => {
  const notCovered = facts({ covered: false });
  assert.equal(line(notCovered, 1).next.says.at(-1), 'Starbase will ask you once more when the Foreman pushes and when it opens the PR.');
  assert.notEqual(line(notCovered, 1).next.check, line(facts(), 1).next.check, 'what he is told is part of what he said yes to');
  assert.ok(!line(facts(), 1).next.says.some((x) => /ask you once more/.test(x)), 'covered: no such line');
  const update = { list: [gh(247, BRANCH, 'OPEN')], jf: { fork: { exists: true, ahead: 2, behind: 0 } }, push: { pushed: true, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 }, stage: 'pr1' };
  assert.equal(line(facts({ ...update, covered: false }), 1).next.says.at(-1), 'Starbase will ask you once more when the Foreman pushes.');
  assert.ok(!line(facts(update), 1).next.says.some((x) => /ask you once more/.test(x)));
  const open1 = { jf: { fork: { exists: true, ahead: 0, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 0, commits: [], behind: 0 } };
  assert.equal(line(facts({ ...open1, covered: false }), 1).next.says.at(-1), 'Starbase will ask you once more when the Foreman opens the PR.');
  // Request review is no hard line: nothing to add.
  const list = [gh(247, BRANCH, 'MERGED'), gh(248, 'staging', 'OPEN', { review: 'REVIEW_REQUIRED' })];
  const review = line(facts({ list, jf: { fork: { exists: true }, org: { exists: true } }, stage: 'pr2', status: [{ number: 1, state: 'merged' }, { number: 2, state: 'open' }], covered: false }), 2);
  assert.deepEqual(review.next.says, ['Asks Raj to review PR #2 (#248).', 'Pushes nothing.']);
  // Not said at all: the default when the runner doesn't say is not covered.
  const unsaid = facts();
  delete unsaid.covered;
  assert.match(line(unsaid, 1).next.says.at(-1), /ask you once more/);
});

test('fix round 1: goAheadCovers itself agrees: the sentence’s exact push is covered in auto mode at a PR step, and asks otherwise', async () => {
  const { goAheadCovers } = await import('../lib/hard-lines.js');
  const cmd = /`(git push [^`]+)`/.exec(line(facts(), 1).next.sends)[1];
  const ctx = (mode, stage) => ({ mode, stage, worktrees: ['/r/wt'], featureDir: '/f/x', cwd: '/r/wt', branches: [BRANCH], forkOwner: 'you' });
  assert.ok(goAheadCovers('Bash', { command: cmd }, ctx('auto', 'pr1')));
  assert.equal(goAheadCovers('Bash', { command: cmd }, ctx('auto', 'review')), null);
  assert.equal(goAheadCovers('Bash', { command: cmd }, ctx('hands-off', 'pr1')), null);
});

test('fix round 1: unpushedOf keeps its answer while the branch and the fork’s copy stay where they were (two rev-parses, no more)', async () => {
  const { git, calls } = fakeGit([
    [`--verify --quiet refs/remotes/origin/${BRANCH}^{commit}`, 'f'.repeat(40)],
    [`--verify --quiet refs/heads/${BRANCH}^{commit}`, `${TWO[0].sha}\n`],
    [`rev-list --count refs/remotes/origin/${BRANCH}..refs/heads/${BRANCH}`, '2\n'],
    [`rev-list --count refs/heads/${BRANCH}..refs/remotes/origin/${BRANCH}`, '0\n'],
    [`refs/remotes/origin/${BRANCH}..refs/heads/${BRANCH}`, LOG(TWO)],
  ]);
  const cache = new Map();
  const a = await unpushedOf({ dir: '/r/wt', branch: BRANCH, base: 'abc1234', fork: 'origin', git, cache });
  const first = calls.length;
  const b = await unpushedOf({ dir: '/r/wt', branch: BRANCH, base: 'abc1234', fork: 'origin', git, cache });
  assert.deepEqual(b, a);
  assert.equal(calls.length - first, 2, 'only the two rev-parses');
});

// ---------- the automatic tell (fix round 1, I3) ----------

function tellWorld({ watchedSlugs = ['x'], mode = 'workshop', sessionId = 's1', limited = false, auto = false, sent = [], closed = null } = {}) {
  const merged = [gh(247, BRANCH, 'MERGED', { mergedAt: '2026-11-14T14:02:00Z' })];
  const lane = laneFrom(merged, { fork: { exists: true }, org: { exists: true } });
  const sessions = { '/f/x': { sentNudges: [...sent], dismissedNudges: [], auto: { on: auto } }, '/f/y': { sentNudges: [] } };
  const job = (slug) => ({ slug, dir: `/f/${slug}`, stage: 'pr1', prs: [{ number: 1, state: 'open' }], closed });
  const sends = [];
  const deps = {
    jobs: [job('x'), job('y')],
    watched: (slug) => watchedSlugs.includes(slug),
    sessionFor: async (dir) => sessions[dir],
    laneOf: () => lane,
    driveOf: async () => ({ mode, sessionId }),
    limited: () => limited,
    closed: (f) => Boolean(f.closed),
    send: async (f, t, o) => { sends.push([f.slug, t.id, t.text, o]); sessions[f.dir].sentNudges.push(t.id); },
  };
  return { deps, sends, sessions };
}

test('fix round 1: the tell goes only to a job a page is watching, to a free Foreman, once, as Starbase’s own send', async () => {
  const w = tellWorld();
  assert.deepEqual(await tellMerges(w.deps), [{ slug: 'x', id: 'pr1-merged' }]);
  assert.deepEqual(w.sends, [['x', 'pr1-merged', 'PR #1 (#247) is already merged on GitHub (Starbase just checked). Update status.json and carry on from there; don\'t ask me to merge it.', { by: 'starbase' }]]);
  assert.deepEqual(await tellMerges(w.deps), [], 'never twice: it is remembered as sent');
  assert.equal(w.sends.length, 1);
});

test('fix round 1: no tell when nobody watches the job, the Foreman is busy, in a terminal or has no session, at the usage limit, in Auto, closed, or already told before a restart', async () => {
  for (const [why, over] of [
    ['no page watching', { watchedSlugs: [] }], ['replying', { mode: 'running' }], ['in a terminal', { mode: 'terminal' }],
    ['no session', { mode: 'none', sessionId: null }], ['usage limit', { limited: true }], ['Auto is on', { auto: true }],
    ['closed', { closed: { as: 'done', at: '2026-11-14T15:00:00Z' } }], ['told before a restart', { sent: ['pr1-merged'] }],
  ]) {
    const w = tellWorld(over);
    assert.deepEqual(await tellMerges(w.deps), [], why);
    assert.equal(w.sends.length, 0, why);
  }
});

test('fix round 1: a send that is refused tells nothing and leaves it for the next read', async () => {
  const w = tellWorld();
  w.deps.send = async () => { throw new Error('The Foreman is still working'); };
  assert.deepEqual(await tellMerges(w.deps), []);
  assert.deepEqual(w.sessions['/f/x'].sentNudges, []);
});

// ---------- Task 21: the comments on a line, and Push the fixes ----------

test('pr lines (Task 21): a line carries its comment counts; fixed comments make PR #1’s push `Push the fixes (2 commits)`', () => {
  const list = [gh(247, BRANCH, 'OPEN', { checks: [{ conclusion: 'SUCCESS' }] })];
  const base = { list, jf: { fork: { exists: true, ahead: 2, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 }, stage: 'pr1' };
  const fresh = line(facts({ ...base, comments: { 1: { fresh: 3, total: 4, fixed: 0, failing: 1, v: 'abc' } } }), 1);
  assert.deepEqual(fresh.comments, { fresh: 3, total: 4, fixed: 0, failing: 1, v: 'abc' });
  assert.equal(fresh.next.id, 'push-update', 'nothing fixed yet: a plain update');
  assert.equal(line(facts(base), 1).comments, null, 'not read: no counts');
  const fixed = line(facts({ ...base, comments: { 1: { fresh: 1, total: 4, fixed: 2, failing: 0, v: 'def' } } }), 1);
  assert.equal(fixed.next.id, 'push-fixes');
  assert.equal(fixed.next.label, 'Push the fixes (2 commits)');
  assert.equal(fixed.next.go, 'Push');
  assert.deepEqual(fixed.next.says.slice(0, 3), [`Pushes 2 commits from ${BRANCH} to your fork (origin), so PR #1 (#247) has them:`, 'bbbbbbb Show the damage list', 'aaaaaaa Add the damage table']);
  assert.match(fixed.next.sends, /^Please push the fixes for the review comments: feature\/orbit-9-damage-list to origin as it is now, 2 commits PR #1 \(#247\) doesn’t have yet, ending at bbbbbbb\. Push exactly that commit: `git push origin bbbbbbb10{32}:refs\/heads\/feature\/orbit-9-damage-list`\. Only this push: don’t reply or resolve anything on GitHub/);
  assert.notEqual(fixed.next.check, fresh.next.check);
});

test('pr lines (Task 21): a review round ready to send back → `Push the fixes (n commits)` saying the round’s own steps', async () => {
  const { sendPlan } = await import('../lib/review-round.js');
  const round = { reviewer: 'raj', prLabel: 'PR #1', pr: 1, requestedAt: null, items: [
    { id: 'c901', type: 'line', included: true, added: true, reply: 'Done.', state: 'fixed', resolved: false, author: 'raj', file: 'a.ts', line: 4 },
  ] };
  const steps = sendPlan(round, { ahead: 2, fork: 'origin', branch: BRANCH, orgRemote: 'moxie', twoStep: true, mergeFollowUp: true }).map((p) => p.words);
  const list = [gh(247, BRANCH, 'OPEN', { checks: [{ conclusion: 'SUCCESS' }], review: 'CHANGES_REQUESTED' })];
  const f = facts({ list, jf: { fork: { exists: true, ahead: 2, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 }, stage: 'pr1', inRound: true,
    round: { ready: true, number: 247, round: 2, reviewer: 'raj', ahead: 2, steps, replies: [{ id: 'c901', words: 'to raj on a.ts:4' }] } });
  const l = line(f, 1);
  assert.equal(l.next.id, 'push-fixes');
  assert.equal(l.next.round, true);
  assert.equal(l.next.label, 'Push the fixes (2 commits)');
  assert.equal(l.next.go, 'Send back');
  assert.deepEqual(l.next.says, ['Sends back round 2 on PR #1 (#247), 4 steps:', 'Push 2 commits to your fork', 'bbbbbbb Show the damage list', 'aaaaaaa Add the damage table', 'Reply on GitHub to each of raj’s 1 comment', '  Reply to raj on a.ts:4', 'Mark the 1 fixed comment resolved', 'Ask raj to review PR #1 again']);
  assert.match(l.next.sends, /^Starbase sends back round 2 on PR #1 \(#247\): Push 2 commits to your fork; Reply on GitHub/);
  const other = line({ ...f, round: { ...f.round, steps: steps.slice(1) } }, 1);
  assert.notEqual(other.next.check, l.next.check, 'another plan, another check');
  assert.equal(line({ ...f, round: null }, 1).next.id, 'push-update', 'not ready: the plain update');
});

test('pr lines (Task 21 fix round 1, C1): a round on PR #2 of a two-step repository says the follow-up PR #1 and its merge', async () => {
  const { sendPlan } = await import('../lib/review-round.js');
  const round = { reviewer: 'raj', prLabel: 'PR #2', pr: 2, requestedAt: null, items: [
    { id: 'c901', type: 'line', included: true, added: true, reply: 'Done.', state: 'fixed', resolved: false, author: 'raj', file: 'a.ts', line: 4 },
  ] };
  const list = [gh(247, BRANCH, 'MERGED', { mergedAt: '2026-11-14T14:02:00Z' }), gh(248, 'staging', 'OPEN', { review: 'CHANGES_REQUESTED' })];
  const base = { list, jf: { fork: { exists: true, ahead: 2, behind: 0 }, org: { exists: true } }, push: { pushed: true, head: TWO[0].sha, count: 2, commits: TWO, behind: 0 }, stage: 'pr2', status: [{ number: 1, state: 'merged' }, { number: 2, state: 'open' }], inRound: true };
  for (const merge of [true, false]) {
    const steps = sendPlan(round, { ahead: 2, fork: 'origin', branch: BRANCH, orgRemote: 'moxie', twoStep: true, mergeFollowUp: merge }).map((p) => p.words);
    const l = line(facts({ ...base, round: { ready: true, number: 248, round: 3, reviewer: 'raj', ahead: 2, steps, replies: [] } }), 2);
    assert.equal(l.next.id, 'push-fixes');
    assert.deepEqual(l.next.says.slice(1).filter((w) => !/^[0-9a-f]{7} /.test(w)), steps, 'every step, word for word');
    assert.deepEqual(l.next.says.slice(2, 4), ['bbbbbbb Show the damage list', 'aaaaaaa Add the damage table'], 'the commits the push carries, under it');
    const follow = l.next.says.find((w) => /follow-up PR #1/.test(w));
    assert.ok(follow, 'the follow-up PR #1 is said');
    assert.equal(/and merge it once its checks pass$/.test(follow), merge, 'and its merge, when the setting says so');
    assert.ok(l.next.sends.includes(follow));
  }
});

// ---------- Phase 4 fixes ----------

test('pr lines (Phase 4 B2): Sent holds on the action and its commit; the count of uncommitted files moving brings no second button', () => {
  const f = facts({ jf: { dirty: 3 } });
  const first = line(f, 1);
  assert.match(first.next.says.join('\n'), /3 changed files not committed/);
  const later = { ...f, lane: { ...f.lane, dirty: 4 }, pending: [first.next.key] };
  const again = line(later, 1);
  assert.equal(again.next, null, 'the same push, still on its way');
  assert.equal(again.why, 'Sent to the Foreman');
  assert.notEqual(line({ ...later, pending: [] }, 1).next.check, first.next.check, 'the words did move');
  assert.equal(first.next.key, `push-open@${TWO[0].sha}`);
});

test('pr lines (Phase 4): a job with no branch yet says so on PR #1', async () => {
  const { NO_BRANCH } = await import('../lib/pr-lines.js');
  const l = line(facts({ push: null, noBranch: true }), 1);
  assert.equal(l.next, null);
  assert.equal(l.why, 'No branch yet: the PRs start after the build');
  assert.equal(NO_BRANCH, l.why);
  assert.equal(line(facts({ push: null }), 1).why, null, 'unknown: nothing said');
});
