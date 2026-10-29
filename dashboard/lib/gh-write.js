// The only code in Ground Control that writes to GitHub (packet Q). Every call needs your yes (a
// token from yes(), made where you said go: a route answering your click, never a timer), runs one
// fixed command, and writes one audit line 'gh-write' with what it ran and how it went.
//
//   push           git -C <worktree> push <fork remote> <branch>: no flags at all, so nothing is
//                  ever forced; never to an org remote or an org address (lib/hard-lines.js), never
//                  main, master or staging; refused when another process holds the job's lock
//   openPr         gh pr create --repo R --base B --head owner:branch --title T --body B
//   mergePr        gh pr merge N --repo R --merge (or --squash when the route says so)
//   reply          gh api --method POST repos/R/pulls/N/comments/ID/replies (a line comment), or a
//                  comment on the PR quoting a review or conversation comment
//   resolveThread  gh api graphql: the review thread holding a comment, marked resolved
//   requestReview  gh pr edit N --repo R --add-reviewer login
//   reopenPr       gh pr reopen N --repo R
//   comment        gh pr comment N --repo R --body B
//
// localOnly (tests and the demo): a push goes only to a remote whose address is a local folder,
// and gh is whatever fake the caller passes. Nothing here reads a token or talks to GitHub but
// through gh.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { ORG_REMOTES, ORG_URL, hardLine } from './hard-lines.js';
import { scrub } from './orbit.js';

const YES = Symbol('gh-write: your yes');
const REMOTE = /^[A-Za-z0-9][\w.-]{0,99}$/;
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*[~^:?*[\\\s+@{])[\w./-]{1,200}$/;
const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const PROTECTED = new Set(['main', 'master', 'staging']);
const MAX_BODY = 60000;

/** A write was refused before anything ran (no yes, a hard line, a bad argument, the lock). */
export class WriteRefused extends Error {
  constructor(message, { code = 'refused' } = {}) { super(message); this.code = code; }
}

/**
 * Your yes for one write (or one Send back's steps): what you said go to, and when. Only code
 * answering your click makes one; a write without it is refused before anything runs.
 */
export function yes({ what, by = 'you', at = new Date().toISOString() } = {}) {
  if (!what) throw new Error('A yes says what it is for.');
  return Object.freeze({ [YES]: true, what: String(what), by, at });
}
export const isYes = (y) => Boolean(y && y[YES] === true);

function runGit(dir, args, { timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout ?? ''), err: err ? String(stderr || err.message).trim().split('\n').slice(-1)[0] : null }));
  });
}

// What a failure says, and GitHub's status code when it gave one ("HTTP 502").
const codeOf = (err) => /\bHTTP (\d{3})\b/.exec(String(err ?? ''))?.[1] ?? /\b(\d{3})\b/.exec(String(err ?? ''))?.[1] ?? null;
const isLocalPath = (url) => /^(\/|\.{1,2}\/|file:\/\/)/.test(String(url ?? '')) && !/github\.com/i.test(String(url));

/**
 * The writer. gh(args) → { ok, out, err }: the gh runner (a test passes a fake that
 * records calls). git(dir, args): git (tests: real git on local bare repositories). audit(line):
 * an audit line. lockFor(featureDir): the lock when another process holds it, or null.
 * localOnly: pushes only to local folders (tests, the demo).
 */
export function createGhWrite({ gh, git = runGit, audit = async () => {}, lockFor = () => null, localOnly = false } = {}) {
  if (typeof gh !== 'function') throw new Error('createGhWrite needs a gh runner');

  async function call(what, ctx, run) {
    const { yes: y, featureDir = null, slug = null } = ctx ?? {};
    const line = { action: 'gh-write', what, featureDir: featureDir ?? undefined, slug: slug ?? undefined };
    try {
      if (!isYes(y)) throw new WriteRefused('Nothing is written to GitHub without your yes.', { code: 'no-yes' });
      const lock = featureDir ? lockFor(featureDir) : null;
      if (lock) throw new WriteRefused(`Another process holds this job (pid ${lock.pid ?? 'unknown'}${lock.branch ? `, branch ${lock.branch}` : ''}): nothing is written until it lets go.`, { code: 'job-locked' });
      const res = await run();
      const out = { ok: Boolean(res.ok), out: res.out ?? '', err: res.ok ? null : scrub(String(res.err ?? 'it failed')).slice(0, 500), code: res.ok ? null : codeOf(res.err), command: res.command };
      await audit({ ...line, yes: y.what, command: res.command, ok: out.ok, err: out.err ?? undefined, code: out.code ?? undefined, ...(res.extra ?? {}) });
      return { ...out, ...(res.extra ?? {}) };
    } catch (err) {
      if (!(err instanceof WriteRefused)) throw err;
      await audit({ ...line, yes: isYes(y) ? y.what : undefined, ok: false, refused: err.code, err: err.message });
      throw err;
    }
  }
  const ghCall = async (args) => ({ ...(await gh(args)), command: `gh ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a.length > 80 ? `${a.slice(0, 77)}…` : a) : a)).join(' ')}` });
  const needRepo = (repo) => { if (!REPO.test(String(repo ?? ''))) throw new WriteRefused('Unexpected repository name.', { code: 'bad-argument' }); };
  const needNumber = (n) => { if (!Number.isInteger(n) || n < 1) throw new WriteRefused('Unexpected pull request number.', { code: 'bad-argument' }); };
  const needBody = (b) => { const t = String(b ?? '').trim(); if (!t) throw new WriteRefused('Nothing to post: the text is empty.', { code: 'bad-argument' }); return t.slice(0, MAX_BODY); };

  return {
    /** git push <remote> <branch> from the job's worktree. No flags, so never forced. */
    push: (ctx) => call('push', ctx, async () => {
      const { dir, remote, branch } = ctx;
      if (!dir || !path.isAbsolute(dir)) throw new WriteRefused('The job’s worktree isn’t known, so nothing can be pushed.', { code: 'bad-argument' });
      if (!REMOTE.test(String(remote ?? ''))) throw new WriteRefused('Unexpected remote name.', { code: 'bad-argument' });
      if (!BRANCH.test(String(branch ?? ''))) throw new WriteRefused('Unexpected branch name.', { code: 'bad-argument' });
      if (PROTECTED.has(branch)) throw new WriteRefused(`${branch} is never pushed from here.`, { code: 'protected-branch' });
      if (ORG_REMOTES.includes(remote)) throw new WriteRefused(`${remote} is the org repository: it is never pushed to.`, { code: 'org-push' });
      const url = await git(dir, ['remote', 'get-url', '--push', remote]);
      if (!url.ok) throw new WriteRefused(`There is no remote called ${remote} here.`, { code: 'bad-argument' });
      if (ORG_URL.test(url.out.trim())) throw new WriteRefused(`${remote} points at the org repository: it is never pushed to.`, { code: 'org-push' });
      if (localOnly && !isLocalPath(url.out.trim())) throw new WriteRefused('Only local folders are pushed to here (a test or the demo).', { code: 'local-only' });
      const command = `git push ${remote} ${branch}`;
      const verdict = hardLine('Bash', { command });
      if (verdict?.decision === 'deny') throw new WriteRefused(verdict.reason, { code: 'hard-line' });
      const res = await git(dir, ['push', remote, branch]);
      return { ...res, command };
    }),

    /** gh pr create. head: "owner:branch" (a fork's branch) or "branch". Returns its number and address. */
    openPr: (ctx) => call('open-pr', ctx, async () => {
      const { repo, base, head, title } = ctx;
      needRepo(repo);
      if (!BRANCH.test(String(base ?? '')) || !/^([\w.-]+:)?[\w./-]+$/.test(String(head ?? ''))) throw new WriteRefused('Unexpected branch name.', { code: 'bad-argument' });
      const body = needBody(ctx.body);
      const t = needBody(title).slice(0, 250);
      const res = await ghCall(['pr', 'create', '--repo', repo, '--base', base, '--head', head, '--title', t, '--body', body]);
      const url = /https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/.exec(res.out ?? '');
      return { ...res, extra: { url: url?.[0] ?? null, number: url ? Number(url[1]) : null } };
    }),

    /** gh pr merge: a merge commit, or a squash when the route says so. Never --admin, never --auto. */
    mergePr: (ctx) => call('merge', ctx, async () => {
      const { repo, number, method = 'merge' } = ctx;
      needRepo(repo); needNumber(number);
      if (!['merge', 'squash'].includes(method)) throw new WriteRefused('A merge is a merge commit or a squash.', { code: 'bad-argument' });
      return ghCall(['pr', 'merge', String(number), '--repo', repo, `--${method}`]);
    }),

    /** A reply to one comment: in its thread for a line comment, else a comment on the PR that quotes it. */
    reply: (ctx) => call('reply', ctx, async () => {
      const { repo, number, comment } = ctx;
      needRepo(repo); needNumber(number);
      const body = needBody(ctx.body);
      if (!Number.isInteger(comment?.id) || comment.id < 1) throw new WriteRefused('Unexpected comment id.', { code: 'bad-argument' });
      if (comment.type === 'line') {
        const res = await ghCall(['api', '--method', 'POST', `repos/${repo}/pulls/${number}/comments/${comment.id}/replies`, '-f', `body=${body}`]);
        return { ...res, extra: { posted: res.ok ? (() => { try { return JSON.parse(res.out).id ?? null; } catch { return null; } })() : null } };
      }
      const quote = String(comment.quote ?? '').split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
      const text = `${comment.author ? `@${comment.author} ` : ''}${quote ? `\n> ${quote.slice(0, 200)}\n\n` : ''}${body}`.trim();
      const res = await ghCall(['api', '--method', 'POST', `repos/${repo}/issues/${number}/comments`, '-f', `body=${text}`]);
      return { ...res, extra: { posted: res.ok ? (() => { try { return JSON.parse(res.out).id ?? null; } catch { return null; } })() : null } };
    }),

    /** Mark the review thread that holds a line comment resolved (already resolved: nothing to do). */
    resolveThread: (ctx) => call('resolve', ctx, async () => {
      const { repo, number, commentId } = ctx;
      needRepo(repo); needNumber(number);
      if (!Number.isInteger(commentId) || commentId < 1) throw new WriteRefused('Unexpected comment id.', { code: 'bad-argument' });
      const [owner, name] = repo.split('/');
      const find = await ghCall(['api', 'graphql', '-f', 'query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved comments(first:100){nodes{databaseId}}}}}}}', '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`]);
      if (!find.ok) return find;
      let thread = null;
      try {
        const nodes = JSON.parse(find.out)?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
        thread = nodes.find((t) => (t?.comments?.nodes ?? []).some((c) => c?.databaseId === commentId)) ?? null;
      } catch { return { ok: false, err: 'gh api graphql: unreadable output', command: find.command }; }
      if (!thread) return { ok: false, err: 'its thread wasn’t found on the pull request', command: find.command };
      if (thread.isResolved) return { ok: true, out: '', command: find.command, extra: { already: true } };
      if (!/^[\w=-]{1,200}$/.test(String(thread.id))) return { ok: false, err: 'unexpected thread id', command: find.command };
      return ghCall(['api', 'graphql', '-f', 'query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}', '-f', `id=${thread.id}`]);
    }),

    /** Ask someone (again) to review. */
    requestReview: (ctx) => call('request-review', ctx, async () => {
      const { repo, number, login } = ctx;
      needRepo(repo); needNumber(number);
      if (!LOGIN.test(String(login ?? ''))) throw new WriteRefused('That isn’t a GitHub name.', { code: 'bad-argument' });
      return ghCall(['pr', 'edit', String(number), '--repo', repo, '--add-reviewer', login]);
    }),

    /** Reopen a PR closed without merging. */
    reopenPr: (ctx) => call('reopen', ctx, async () => {
      const { repo, number } = ctx;
      needRepo(repo); needNumber(number);
      return ghCall(['pr', 'reopen', String(number), '--repo', repo]);
    }),

    /** A comment from you on the PR, exactly as written. */
    comment: (ctx) => call('comment', ctx, async () => {
      const { repo, number } = ctx;
      needRepo(repo); needNumber(number);
      return ghCall(['pr', 'comment', String(number), '--repo', repo, '--body', needBody(ctx.body)]);
    }),
  };
}

/**
 * Run steps in order, each one function → { ok, err, code, skipped }. The first failure stops the
 * rest (marked 'not-run'); a step that answers { ok, waiting } is done and the rest wait
 * ('after-pr1'); stopAfter() true after a step stops there too. onStep(step, i) is told
 * before and after each one. Steps already 'done' are skipped (Try again from here). Returns
 * { ok, stoppedAt (index) | null, steps }.
 */
export async function runSteps(steps, { onStep = async () => {}, stopAfter = () => false } = {}) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.state === 'done' || s.state === 'skipped') continue;
    s.state = 'working';
    s.error = null;
    await onStep(s, i);
    let res;
    try { res = await s.run(); } catch (err) { res = { ok: false, err: err?.message ?? String(err), code: err?.code ?? null }; }
    // waiting: this step is done and the rest wait for something outside (the follow-up PR #1 merged by you).
    if (res?.ok) s.state = res.skipped ? 'skipped' : 'done';
    else { s.state = 'stopped'; s.error = res?.err ?? 'it failed'; s.code = res?.code ?? null; s.failWords = res?.failWords ?? null; }
    await onStep(s, i);
    if (s.state === 'stopped' || res?.waiting) {
      for (const rest of steps.slice(i + 1)) if (rest.state !== 'done') rest.state = res?.waiting ? 'after-pr1' : 'not-run';
      return { ok: false, stoppedAt: i, waiting: Boolean(res?.waiting) && s.state !== 'stopped', steps };
    }
    if (i < steps.length - 1 && stopAfter()) {
      for (const rest of steps.slice(i + 1)) if (rest.state !== 'done') rest.state = 'not-run';
      return { ok: false, stoppedAt: i, stoppedByYou: true, steps };
    }
  }
  return { ok: true, stoppedAt: null, steps };
}
