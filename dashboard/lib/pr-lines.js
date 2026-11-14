// The job page's PR lines (the job page rebuild, Task 20; design brief R2; phase4-design.md): PR #1,
// PR #2 and PR #3, each one line with its state as GitHub last told the flow map, and at most ONE next
// action, which says exactly what it will send and push before his yes.
//
//   prLines(facts)      pure: { lines: PrLine[3], github: GithubRead | null }
//   unpushedOf(o)       read-only git: the commits a push of the job's branch to the fork would carry
//   mergedToTell(o)     pure: the merges by hand the Foreman hasn't seen, each with its nudge's own sentence
//   readDue(github)     whether the page's opening should read GitHub (the last read is over two minutes old)
//   PR_SENTENCES        the fixed sentence of each action
//
// What a button does: its second click (his yes) sends that action's fixed sentence to the job's
// Foreman, which does the git work itself. The Foreman's `git push` and `gh pr create` meet the hard
// lines and the go-ahead the PR steps already have (lib/hard-lines.js goAheadCovers: in Auto mode at a
// PR stage they run, otherwise each asks with a card): nothing here allows a push, and nothing here
// writes to GitHub. The sentence names the branch, its head commit, the commit count, from where to
// where and the title, so what goes is what he saw; the runner sends it only when the line built again
// at the click gives the same sentence (`check`). Starbase's own writes are lib/gh-write.js's.
//
// The GitHub read is the flow map's (lib/flow.js FlowWatch.refresh({ network: true })): there is no
// second reader. When it could not read (gh signed out, no network), or has never read, or the job is
// closed, on the website, or the fork is ahead of the branch, a line has no button and says why.
//
// PrLine { n, number, url, title, state: 'not-started' | 'open' | 'draft' | 'merged' | 'closed', word,
//          at (merged: when; open: when opened), next: null | PrNext, why: string | null, comments }
// PrNext { id: 'push-open' | 'open-pr1' | 'push-update' | 'open-pr2' | 'request-review', label (the
//          line's button), go (the yes button), says: string[] (what will go, line by line), sends (the
//          exact sentence), check (12 hex of the action, its sentence and its says) }
// GithubRead { at (the last read that worked), triedAt, reading, problem (in words), run (the line to run) }

import { createHash } from 'node:crypto';
import { PR2_OPEN_SENTENCE, PR2_REVIEW_SENTENCE, nudgesFor } from './nudges.js';

/** The page's opening reads GitHub when the last read is older than this. */
export const READ_MAX_AGE_MS = 2 * 60 * 1000;
/** At most this many commits are listed in what a push will carry (the count is always the whole). */
export const COMMITS_LISTED = 200;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (sha) => String(sha ?? '').slice(0, 7);
const NAME = /^(?!-)(?!.*\.\.)(?!.*[~^:?*[\\\s@{])[\w./-]{1,200}$/;
const REMOTE = /^[A-Za-z0-9][\w.-]{0,99}$/;
const BASE = /^(?!-)[\w./-]{1,200}$/;

const ORG_BRANCH_FIRST = ' (make that org branch from main first, as the skill says)';

/** The fixed sentence of each action. x: { branch, fork, forkOwner, org, head (short), count, title, orgBranch, number }. */
export const PR_SENTENCES = Object.freeze({
  'push-open': (x) => `Please push ${x.branch} to ${x.fork} as it is now (${plural(x.count, 'commit')}, ending at ${x.head}), then open PR #1 from ${x.forkOwner}:${x.branch} into ${x.branch} on ${x.org}${x.orgBranch ? '' : ORG_BRANCH_FIRST}, titled "${x.title}". Nothing else goes to GitHub. If something must be committed before the push (main brought in, the decisions file), commit it and stop there, so I see what will go.`,
  'open-pr1': (x) => `Please open PR #1 from ${x.forkOwner}:${x.branch} into ${x.branch} on ${x.org}${x.orgBranch ? '' : ORG_BRANCH_FIRST}, titled "${x.title}". ${x.branch} is already on ${x.fork} at ${x.head}: push nothing. Nothing else goes to GitHub.`,
  'push-update': (x) => `Please push ${x.branch} to ${x.fork} as it is now: ${plural(x.count, 'commit')} PR #1${x.number ? ` (#${x.number})` : ''} doesn’t have yet, ending at ${x.head}. Only this push: nothing else goes to GitHub.`,
  'open-pr2': (x) => `${PR2_OPEN_SENTENCE} From ${x.branch} into staging on ${x.org}, titled "${x.title}". Only this PR: no reviewer yet, and nothing else goes to GitHub.`,
  'request-review': () => PR2_REVIEW_SENTENCE,
});
/** The nudge each PR #2 action stands for: once sent, the Desk doesn't ask again (sentNudges). */
export const ACTION_NUDGE = Object.freeze({ 'open-pr2': 'pr2-open', 'request-review': 'pr2-review' });

const LABELS = {
  'push-open': () => ({ label: 'Push and open PR #1', go: 'Push and open' }),
  'open-pr1': () => ({ label: 'Open PR #1', go: 'Open PR #1' }),
  'push-update': (x) => ({ label: `Push update (${plural(x.count, 'commit')})`, go: 'Push' }),
  'open-pr2': () => ({ label: 'Open PR #2', go: 'Open PR #2' }),
  'request-review': () => ({ label: 'Request review', go: 'Request review' }),
};

/** A PR's state in a few words: `not open`, `open · checks passed · approved`, `merged` (lib/job-payload.js's word). */
export function prWord(pr) {
  switch (pr?.state) {
    case 'open': return ['open', pr.checks ? `checks ${pr.checks}` : null, pr.review === 'approved' ? 'approved' : pr.review === 'changes' ? 'changes asked' : null].filter(Boolean).join(' · ');
    case 'draft': case 'merged': case 'closed': return pr.state;
    default: return 'not open';
  }
}

/** The GitHub line from the flow map's (FlowWatch view().github), or null when there is none. */
function githubRead(g) {
  if (!g || typeof g !== 'object') return null;
  return { at: g.checkedAt ?? null, triedAt: g.triedAt ?? null, reading: Boolean(g.checking), problem: g.problem?.words ?? null, run: g.problem?.run ?? null };
}

const hash = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/** One action, whole: its label, yes, what it says, the sentence and the check. */
function action(id, x, says) {
  const sends = PR_SENTENCES[id](x);
  return { id, ...LABELS[id](x), says, sends, check: hash(`${id}\n${sends}\n${says.join('\n')}`) };
}

const commitLines = (commits) => (commits ?? []).slice(0, COMMITS_LISTED).map((c) => `${c.short ?? short(c.sha)} ${c.subject ?? ''}`.trim());
const moreLine = (push) => (push.count > COMMITS_LISTED ? [`and ${plural(push.count - COMMITS_LISTED, 'older commit')}`] : []);
const dirtyLine = (lane) => (lane?.dirty > 0 ? [`${plural(lane.dirty, 'changed file')} not committed stay${lane.dirty === 1 ? 's' : ''} on this computer.`] : []);

/**
 * The three lines. facts (what the runner knows, all at the cache's rebuild; none of it read here):
 *   rows     lib/job-page.js prRows(status.json prs, lane): three { n, number, title, url, state, review, checks }
 *   lane     the job's flow lane (lib/flow.js laneOf), or null
 *   repo     { org: { remote, slug }, fork: { remote, slug } } from the lane's repository in the flow map
 *   github   the flow map's GitHub line (view().github)
 *   push     unpushedOf(): { pushed, head, count, commits, behind }, or null when not known
 *   job      { stage, prs (status.json's), closed, title, key }
 *   sent, dismissed   the job's nudge ids sent to the Foreman, and set aside on the Desk
 *   inRound  a review round is going (its own steps cover PR #2's review)
 *   pending  the checks of PR sentences sent and still on their way
 *   hosted   built on the website: nothing to act on there
 */
export function prLines(facts = {}) {
  const { rows = [], lane = null, repo = null, push = null, job = {}, sent = [], inRound = false, pending = [], hosted = false } = facts;
  const github = githubRead(facts.github);
  const byN = (n) => (Array.isArray(rows) ? rows.find((r) => r?.n === n) : null) ?? { n, state: 'not-started' };
  const p1 = byN(1);
  const p2 = byN(2);
  const lanePr = (n) => (n === 1 ? lane?.pr1 : n === 2 ? lane?.pr2 : null) ?? null;
  const branch = lane?.branch ?? job.branch ?? null;
  const org = repo?.org?.slug ?? null;
  const fork = repo?.fork?.remote ?? null;
  const forkOwner = repo?.fork?.slug ? String(repo.fork.slug).split('/')[0] : null;
  const title = String(job.title ?? '').trim() ? (job.key && !String(job.title).includes(job.key) ? `${job.key}: ${job.title}` : String(job.title).trim()) : null;
  // Nothing to act on at all: the website, no GitHub line, a closed job, a flow without a fork and an org branch.
  const quiet = hosted || !github || Boolean(job.closed) || !org || !fork || !forkOwner || !branch;
  const card = { stage: job.stage ?? null, prs: job.prs ?? null, closed: job.closed ?? null, finish: { reached: false } };
  const nudgeIds = (s) => new Set(lane ? nudgesFor(card, lane, { sent: s, inRound }).map((x) => x.id) : []);
  const offered = nudgeIds(sent);
  const offeredUnsent = nudgeIds([]);
  const x = { branch, fork, forkOwner, org, title, orgBranch: Boolean(lane?.orgBranch), head: short(push?.head), count: push?.count ?? 0 };

  /** PR #1's candidate action (before GitHub's state, the fork and what was sent are weighed), or a why. */
  function first() {
    if (!push) return { why: null };
    if (p1.state === 'not-started') {
      if (push.count > 0) {
        return { next: action('push-open', x, [
          `Pushes ${plural(push.count, 'commit')} from ${branch} to your fork (${fork}):`, ...commitLines(push.commits), ...moreLine(push),
          `Opens PR #1: ${forkOwner}:${branch} → ${branch} on ${org}`, `Title: ${title}`,
          ...(x.orgBranch ? [] : [`${branch} isn’t on ${org} yet: the Foreman makes it from main first.`]), ...dirtyLine(lane),
        ]), push: true };
      }
      if (push.pushed) return { next: action('open-pr1', x, [`Pushes nothing: ${branch} is on your fork (${fork}) at ${x.head}.`, `Opens PR #1: ${forkOwner}:${branch} → ${branch} on ${org}`, `Title: ${title}`, ...(x.orgBranch ? [] : [`${branch} isn’t on ${org} yet: the Foreman makes it from main first.`])]) };
      return { why: 'No commits yet' };
    }
    if ((p1.state === 'open' || p1.state === 'draft') && push.pushed && push.count > 0) {
      const number = p1.number ?? null;
      return { next: action('push-update', { ...x, number }, [`Pushes ${plural(push.count, 'commit')} from ${branch} to your fork (${fork}), so PR #1${number ? ` (#${number})` : ''} has them:`, ...commitLines(push.commits), ...moreLine(push), ...dirtyLine(lane)]), push: true };
    }
    return { why: null };
  }
  /** PR #2's: the hand-off nudges decide when (lib/nudges.js), so the Desk and the page never disagree. */
  function second() {
    const pick = (id, nudge, make) => (offered.has(nudge) ? { next: make() } : offeredUnsent.has(nudge) ? { why: 'Sent to the Foreman' } : null);
    const t2 = p1.title ?? title;
    return pick('open-pr2', 'pr2-open', () => action('open-pr2', { ...x, title: t2 }, [`Opens PR #2: ${branch} on ${org} → staging`, `Title: ${t2}`, 'Pushes nothing: PR #2 carries what PR #1 merged.']))
      ?? pick('request-review', 'pr2-review', () => action('request-review', x, [`Asks Raj to review PR #2${p2.number ? ` (#${p2.number})` : ''}.`, 'Pushes nothing.']))
      ?? { why: p2.state === 'not-started' && p1.state !== 'merged' ? 'after PR #1 is merged' : null };
  }

  const lines = [1, 2, 3].map((n) => {
    const row = byN(n);
    const lp = lanePr(n);
    const at = row.state === 'merged' ? lp?.mergedAt ?? null : row.state === 'open' || row.state === 'draft' ? lp?.createdAt ?? row.openedAt ?? null : null;
    const out = { n, number: row.number ?? null, url: row.url ?? null, title: row.title ?? null, state: row.state ?? 'not-started', word: prWord(row), at, next: null, why: null, comments: null };
    // A PR not open yet that waits for the one before says so, wherever the page is.
    const waits = out.state === 'not-started' && n > 1 && byN(n - 1).state !== 'merged' ? `after PR #${n - 1} is merged` : null;
    if (n === 3 || quiet) { out.why = waits; return out; }
    const c = n === 1 ? first() : second();
    if (!c.next) { out.why = c.why ?? null; return out; }
    if (github.problem) out.why = 'No button while GitHub isn’t answering';
    else if (!github.at) out.why = 'GitHub not read yet';
    else if (c.push && push.behind > 0) out.why = `Your fork has ${plural(push.behind, 'commit')} this branch doesn’t: a push would be refused. Ask the Foreman to bring ${push.behind === 1 ? 'it' : 'them'} in first.`;
    else if (pending.includes(c.next.check)) out.why = 'Sent to the Foreman';
    else out.next = c.next;
    return out;
  });
  return { lines, github };
}

/**
 * The commits a push of the job's branch to the fork carries, newest first: those the fork's copy
 * (refs/remotes/<fork>/<branch>) lacks, or, never pushed, base..branch. behind: commits the fork has
 * that the branch doesn't (a push without force would be refused). Read-only git: rev-parse,
 * rev-list and log. git(dir, args) → { ok, out, err }. Null when the names are odd, there is no
 * such branch, or (never pushed) no base to count from.
 */
export async function unpushedOf({ dir, branch, base = null, fork, git }) {
  if (!dir || !NAME.test(String(branch ?? '')) || !REMOTE.test(String(fork ?? '')) || (base !== null && !BASE.test(String(base)))) return null;
  const local = `refs/heads/${branch}`;
  const remote = `refs/remotes/${fork}/${branch}`;
  const head = await git(dir, ['rev-parse', '--verify', '--quiet', `${local}^{commit}`]);
  if (!head?.ok || !head.out.trim()) return null;
  const pushed = Boolean((await git(dir, ['rev-parse', '--verify', '--quiet', `${remote}^{commit}`]))?.ok);
  if (!pushed && !base) return null;
  const range = pushed ? `${remote}..${local}` : `${base}..${local}`;
  const count = await git(dir, ['rev-list', '--count', range]);
  const log = await git(dir, ['log', '--no-color', `--max-count=${COMMITS_LISTED}`, '--format=%H%x1f%h%x1f%s%x1e', range, '--']);
  if (!count?.ok || !log?.ok) return null;
  const commits = log.out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, s, subject] = r.split('\x1f');
    return { sha, short: s, subject: subject ?? '' };
  });
  let behind = 0;
  if (pushed) {
    const b = await git(dir, ['rev-list', '--count', `${local}..${remote}`]);
    behind = b?.ok ? Number(b.out.trim()) || 0 : 0;
  }
  return { pushed, head: head.out.trim(), count: Number(count.out.trim()) || commits.length, commits, behind };
}

/**
 * A merge by hand the Foreman hasn't seen (GitHub has PR #n merged; status.json, at that PR's stage,
 * doesn't): [{ id: 'pr1-merged' | 'pr2-merged', text }] with the nudge's own sentence. Not on a closed
 * job, and not once sent or set aside on the Desk.
 */
export function mergedToTell({ card, lane, sent = [], dismissed = [] } = {}) {
  if (!card || card.closed || !lane) return [];
  return nudgesFor({ ...card, finish: { reached: false } }, lane, { sent, dismissed })
    .filter((x) => /^pr\d-merged$/.test(x.id) && x.action?.send)
    .map((x) => ({ id: x.id, text: x.action.send }));
}

/** Whether to read GitHub now for a page that opened: no read is going and the last try is over two minutes old. */
export function readDue(github, now = Date.now()) {
  if (!github) return true;
  if (github.checking) return false;
  const t = Date.parse(github.triedAt ?? '');
  return !Number.isFinite(t) || now - t > READ_MAX_AGE_MS;
}
