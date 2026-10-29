// Review rounds (packet Q): everything one reviewer asked for in one go, fixed with the Foreman,
// sent back in one go, reviewed again, merged.
//
// A round is one reviewer's review ("Request changes", or two comments or more close together),
// its comments, and the failed checks on the same commit. It lives in the job folder's
// review/rounds/round-<n>.json (the dashboard's record) and round-<n>.md (the same, for the
// Foreman and for a person in the terminal); the Foreman reports its plan and progress in
// status.json prs[k].rounds. Packet N's single cards (lib/pr-feedback.js) stay for a lone comment
// or a lone failed check: the items a round takes are marked 'round' in pr-feedback.json first, so
// N never asks about them too.
//
//   parseRoute()      the profile's prRoute lines → who reviews and who merges each PR
//   guessKind()       change | question | nit, from a comment's words (the Foreman's guess wins,
//                     and yours wins over both)
//   candidatesOf()    GitHub's reviews and comments → the items a round can hold
//   groupRounds()     pure: which items open a round, which join one, which stay N's
//   applyForeman()    the Foreman's status.json report → the round's items and plan
//   reviewView()      pure: one job's whole review state → the panel, the Desk card, the Jobs
//                     card, the Ship stop's bar, each with its one next action, in words
//   foremanMessage()  what the Foreman is sent for "Fix with the Foreman" (kind 'review-round')
//   readRounds() / saveRound()   the files
//   createReviewRounds()  the runner's half: reads GitHub after each refresh (read-only), keeps the
//                     rounds, parks the cards, runs Send back through lib/gh-write.js (the only
//                     code that writes to GitHub), every write behind your yes
//
// Nothing in this file writes to GitHub: every write is a lib/gh-write.js call with your yes.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { scrub, scrubDeep } from './orbit.js';
import { runSteps, yes as yesFor } from './gh-write.js';
import { QUOTE_MAX, checkKey, commentKey, isSummaryBot, lookedAt as lookedAtPr, noteFeedback, readFeedback as readFeedbackRecord } from './pr-feedback.js';

// N's record: the items a round takes are marked 'round', so N never cards them too.
const noteRound = (dir, key) => noteFeedback(dir, key, { state: 'round' });

const READ_GIT = new Set(['rev-list', 'log', 'rev-parse', 'remote', 'status', 'diff']);
/** Read-only git in a job's worktree (counts and commit lines for the words): never a write. */
export function gitRead(dir, args, { timeout = 15000 } = {}) {
  if (!READ_GIT.has(args[0]) || (args[0] === 'remote' && args[1] !== 'get-url')) return Promise.resolve({ ok: false, out: '', err: 'not a read' });
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout ?? ''), err: err ? String(stderr || err.message).split('\n')[0] : null }));
  });
}

export const ROUNDS_DIR = path.join('review', 'rounds');
/** Comments from one person this close together join the same round. */
export const JOIN_MS = 10 * 60 * 1000;
/** Remind the person who merges, from a day after the approval. */
export const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
/** How often to check GitHub while a job waits (minutes): Settings → Workflow. */
export const GITHUB_EVERY_CHOICES = Object.freeze([1, 5, 10, 30]);
export const GITHUB_EVERY_DEFAULT = 1;

export const KINDS = Object.freeze(['change', 'question', 'nit', 'check']);
export const KIND_WORDS = Object.freeze({ change: 'Change', question: 'Question', nit: 'Nit', check: 'Check' });
export const ITEM_STATES = Object.freeze(['todo', 'working', 'fixed', 'answered', 'wont_change', 'left_out']);
/** A round's own states (round-<n>.json). The view adds the PR's: waiting, approved, merged, … */
export const ROUND_STATES = Object.freeze(['asked', 'left', 'fixing', 'sending', 'stopped', 'after-pr1', 'sent', 'check-failed', 'done']);
/** Rounds whose items are still being gathered: a new comment from the reviewer joins them. */
const GATHERING = new Set(['asked', 'left', 'fixing']);

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const clean = (text) => scrub(String(text ?? '')).replace(/\r/g, '');
const cut = (text, max) => { const s = clean(text).trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (sha) => (sha ? String(sha).slice(0, 7) : null);
const ms = (at) => { const t = Date.parse(at ?? ''); return Number.isFinite(t) ? t : null; };

/** "14:02", or "Oct 28, 14:02" on another day than `ref` (local time). */
export function clock(at, ref = null) {
  const d = new Date(at ?? '');
  if (!Number.isFinite(d.getTime())) return 'an unknown time';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const r = ref ? new Date(ref) : null;
  if (!r || !Number.isFinite(r.getTime()) || r.toDateString() === d.toDateString()) return hm;
  const tomorrow = new Date(r); tomorrow.setDate(r.getDate() + 1);
  if (tomorrow.toDateString() === d.toDateString()) return `tomorrow ${hm}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${hm}`;
}

/** "a, b and c". */
export function listWords(list) {
  const xs = list.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
}

// ---------- The route: who reviews and who merges each PR ----------

const person = (name, login = null) => {
  const n = String(name ?? '').trim().replace(/^@/, '');
  if (!n) return null;
  const you = /^you$/i.test(n);
  return { name: you ? 'you' : n, you, login: you ? null : login ?? null };
};

/**
 * The profile's prRoute lines ("PR #2: the moxie branch into staging (Raj reviews and merges it)")
 * → [{ pr, words, from, into, reviewer, merger, youMayMerge, squash }]. reviewer and merger:
 * { name, you, login } or null when the line doesn't say. In the brackets, clauses split by ";" or
 * ",": "<who> reviews it", "<who> reviews and merges it", "<who> merges it", "you may merge it";
 * "@login" after a name gives that person's GitHub login; "squash" merges by squashing.
 * twoStep: the repo has a fork and an org (fork → org branch → staging); without lines, the route
 * is the usual one with nobody named for PR #2 and you allowed to merge (it always asks).
 */
export function parseRoute(lines, { twoStep = true } = {}) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    const m = /^\s*PR\s*#\s*(\d)\s*:\s*(.*)$/i.exec(String(raw ?? ''));
    if (!m) continue;
    const pr = Number(m[1]);
    const text = m[2].trim();
    const bracket = /\(([^()]*)\)\s*$/.exec(text);
    const main = (bracket ? text.slice(0, bracket.index) : text).trim();
    const [from, into] = main.split(/\s+into\s+/i).map((s) => s?.trim() || null);
    const step = { pr, words: text, from: from ?? null, into: into ?? null, reviewer: null, merger: null, youMayMerge: false, squash: /squash/i.test(text) };
    for (const clause of (bracket?.[1] ?? '').split(/[;,]/).map((c) => c.trim()).filter(Boolean)) {
      const login = /@([A-Za-z0-9][\w-]{0,38})/.exec(clause)?.[1] ?? null;
      const words = clause.replace(/@[\w-]+/g, '').replace(/\s+/g, ' ').trim();
      let r;
      if (/^you\s+may\s+merge\b/i.test(words)) step.youMayMerge = true;
      else if ((r = /^(.+?)\s+reviews?(\s+and\s+merges?)?\s+it\b/i.exec(words))) {
        step.reviewer = person(r[1], login);
        if (r[2]) step.merger = person(r[1], login);
      } else if ((r = /^(.+?)\s+merges?\s+it\b/i.exec(words))) step.merger = person(r[1], login);
    }
    if (step.merger?.you) step.youMayMerge = true;
    out.push(step);
  }
  if (!out.length) {
    const you = person('you');
    return twoStep
      ? [{ pr: 1, words: null, from: 'your fork’s branch', into: 'the same-named org branch', reviewer: you, merger: you, youMayMerge: true, squash: false },
         { pr: 2, words: null, from: 'the org branch', into: 'staging', reviewer: null, merger: null, youMayMerge: true, squash: false }]
      : [{ pr: 1, words: null, from: 'your branch', into: 'main', reviewer: null, merger: null, youMayMerge: true, squash: false }];
  }
  return out.sort((a, b) => a.pr - b.pr);
}

/** The route's step for PR #n (or one with nobody named). */
export const routeStep = (route, n) => route.find((s) => s.pr === n) ?? { pr: n, words: null, from: null, into: null, reviewer: null, merger: null, youMayMerge: true, squash: false };

/**
 * The name to show for a GitHub login: the route's person with that login, or whose name it starts
 * with ("raj-moxie" → "Raj"), else the login itself.
 */
export function nameFor(login, route = []) {
  const l = String(login ?? '').toLowerCase();
  if (!l) return 'the reviewer';
  for (const s of route) {
    for (const p of [s.reviewer, s.merger]) {
      if (!p || p.you) continue;
      if (p.login && p.login.toLowerCase() === l) return p.name;
    }
  }
  for (const s of route) {
    for (const p of [s.reviewer, s.merger]) {
      if (!p || p.you || /\s/.test(p.name)) continue;
      if (l.startsWith(p.name.toLowerCase())) return p.name;
    }
  }
  return String(login);
}

/** "PR #1: you · PR #2: Raj · PR #3: the release owner": who merges each, from the route. */
export function whoMergesLine(route) {
  return route.map((s) => `PR #${s.pr}: ${s.merger ? s.merger.name : s.youMayMerge ? 'you' : 'not named'}`).join(' · ');
}

// ---------- Items ----------

const QUESTION_START = /^(why|what|how|is|are|was|were|does|do|did|where|when|which|who|whose|isn['’]t|aren['’]t|doesn['’]t|don['’]t|shouldn['’]t we keep|any reason|can you explain|could you explain)\b/i;

/**
 * A first guess at what a comment asks for. nit: says "nit" (small and optional). question: asks
 * something and wants an answer ("Why …?", "Is this …?"). change: anything else, including
 * "Could you …?" and "Should we …?", which ask for a change.
 */
export function guessKind(body) {
  const text = String(body ?? '').trim();
  if (/^\s*(nit|nitpick)\b|\bnit\s*:|\(nit\)/i.test(text)) return 'nit';
  const sentences = text.replace(/```[\s\S]*?```/g, ' ').split(/(?<=[.?!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const asks = sentences.filter((s) => s.endsWith('?'));
  if (asks.length && asks.every((s) => QUESTION_START.test(s)) && !sentences.some((s) => /^(please|let['’]s|can you|could you|would you|should we|we should|change|rename|use|move|drop|remove|add)\b/i.test(s))) return 'question';
  return 'change';
}

const userOf = (u) => ({ author: String(u?.login ?? 'someone'), bot: u?.type === 'Bot' || /\[bot\]$/i.test(String(u?.login ?? '')) });

/**
 * GitHub's reviews, line comments and conversation comments on PR #number → the items a round can
 * hold, oldest first. Skipped: empty ones, yours (me: your logins), summary bots, approvals. A line
 * comment of a review takes the review's time (comments drafted for a review are sent with it).
 * Outdated: a line comment whose line has changed since (GitHub gives it no line now); it is kept,
 * marked, with the line it was on.
 */
export function candidatesOf({ reviews = [], lineComments = [], issueComments = [], prNumber, me = [] }) {
  const mine = new Set((Array.isArray(me) ? me : [me]).filter(Boolean).map((m) => String(m).toLowerCase()));
  const skip = (who) => mine.has(who.author.toLowerCase()) || isSummaryBot(who.author);
  const byId = new Map((Array.isArray(reviews) ? reviews : []).map((r) => [r.id, r]));
  const pr = { number: prNumber };
  const out = [];
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const who = userOf(r.user);
    if (skip(who) || !String(r.body ?? '').trim() || !['CHANGES_REQUESTED', 'COMMENTED'].includes(r.state)) continue;
    out.push({ id: `r${r.id}`, key: commentKey(pr, `r${r.id}`), type: 'review', githubId: r.id, ...who, body: String(r.body), file: null, line: null, outdated: false, link: r.html_url ?? null, at: r.submitted_at ?? null, reviewId: r.id, reviewState: r.state, commit: r.commit_id ?? null });
  }
  for (const c of Array.isArray(lineComments) ? lineComments : []) {
    const who = userOf(c.user);
    if (skip(who) || !String(c.body ?? '').trim()) continue;
    const review = byId.get(c.pull_request_review_id) ?? null;
    const outdated = !Number.isInteger(c.line) && c.position == null;
    const line = Number.isInteger(c.line) ? c.line : Number.isInteger(c.original_line) ? c.original_line : null;
    out.push({ id: `c${c.id}`, key: commentKey(pr, `c${c.id}`), type: 'line', githubId: c.id, ...who, body: String(c.body), file: c.path ?? null, line, outdated, link: c.html_url ?? null, at: review?.submitted_at ?? c.created_at ?? null, reviewId: review?.id ?? null, reviewState: review?.state ?? null, commit: c.commit_id ?? null, replyTo: c.in_reply_to_id ?? null });
  }
  for (const c of Array.isArray(issueComments) ? issueComments : []) {
    const who = userOf(c.user);
    if (skip(who) || !String(c.body ?? '').trim()) continue;
    out.push({ id: `i${c.id}`, key: null, type: 'issue', githubId: c.id, ...who, body: String(c.body), file: null, line: null, outdated: false, link: c.html_url ?? null, at: c.created_at ?? null, reviewId: null, reviewState: null, commit: null });
  }
  return out.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || a.id.localeCompare(b.id));
}

/** A round's item from a candidate (a comment) or a failed check. */
export function itemOf(c, { late = false } = {}) {
  if (c.type === 'check') {
    return { id: `k:${c.name}@${short(c.head) ?? 'unknown'}`, key: c.key, type: 'check', kind: 'check', kindBy: 'guess', author: null, name: clean(c.name), runId: c.runId ?? null, link: c.link ?? null, head: c.head ?? null, file: null, line: null, outdated: false, quote: null, log: c.log ? cut(c.log, QUOTE_MAX) : null, at: c.at ?? null, included: true, state: 'todo', commit: null, reply: null, replyEdited: false, replyDropped: false, reason: null, plan: null, planText: null, late, added: !late, posted: null, resolved: false };
  }
  return {
    id: c.id, key: c.key, type: c.type, githubId: c.githubId, kind: guessKind(c.body), kindBy: 'guess', author: c.author,
    file: c.file ?? null, line: c.line ?? null, outdated: Boolean(c.outdated), quote: cut(c.body, QUOTE_MAX), link: c.link ?? null, at: c.at ?? null,
    reviewId: c.reviewId ?? null, included: true, state: 'todo', commit: null, reply: null, replyEdited: false, replyDropped: false, reason: null,
    plan: null, planText: null, late, added: !late, posted: null, resolved: false,
  };
}

/** A failed check as a candidate (lib/git.js prChecks' check, on the commit `head`). */
export const checkCandidate = (prNumber, c, head) => ({ type: 'check', key: checkKey({ number: prNumber }, c.name, head), name: c.name, runId: c.runId ?? null, link: c.link ?? null, head });

function newRound({ number, prNumber, route, prLabel, prUrl, author, first, head, at }) {
  return {
    version: 1, round: number, pr: route ?? 1, prNumber, prLabel, prUrl: prUrl ?? null, reviewer: author,
    reviewId: first.reviewId ?? null, reviewState: first.reviewState ?? null, reviewAt: first.at ?? at,
    head: first.commit ?? head ?? null, openedAt: at, lastItemAt: first.at ?? at, state: 'asked', note: null,
    items: [], foreman: null, send: null, followUp: null, sentAt: null, sentHead: null, requestedAt: null,
    approvedAt: null, remindedAt: null, leftAt: null, timeline: [{ at, words: 'The round opened.' }],
  };
}

const roundHas = (round, id) => round.items.some((i) => i.id === id);

/**
 * Which items open a round, which join one, which stay N's. Pure.
 *   rounds: this job's rounds so far (every PR's); candidates: candidatesOf() for this PR;
 *   checks: prChecks().checks on `head`, the PR's newest commit; feedback: pr-feedback.json's items
 *   by key (N's states); firstLook: this PR was never looked at (N's lookedAt); pr: { number (on
 *   GitHub), route (its place on the route: 1, 2 or 3; round.pr), label, url }.
 * A comment joins the reviewer's round on this PR while that round is still being gathered or fixed
 * (asked, left, fixing); once it has gone back, a new comment from them opens the next round. A
 * comment from someone with no round yet opens one when it is part of a "Request changes" review,
 * when two or more of theirs come within JOIN_MS of each other, or when they had a round before;
 * a lone comment stays N's. Failed checks on a gathering round's commit join it; a check that fails
 * on the commit a round was sent back with re-opens it ('check-failed').
 * First look (the comments already there when Ground Control first saw the PR): only a "Request
 * changes" that is still the reviewer's latest word on the PR's newest commit opens a round.
 * Returns { rounds, changed: [round numbers], claimed: [N keys], takeFromN: [N keys whose card is up] }.
 */
export function groupRounds({ rounds = [], candidates = [], checks = [], head = null, feedback = {}, firstLook = false, pr, at = new Date().toISOString(), decision = null }) {
  const all = rounds.map((r) => ({ ...r, items: [...r.items] }));
  const changed = new Set();
  const claimed = [];
  const takeFromN = [];
  const known = new Set(all.flatMap((r) => r.items.map((i) => i.id)));
  const nState = (key) => (key ? feedback?.[key]?.state ?? null : null);
  // Free for a round: never seen by N, or a card of N's still waiting for an answer.
  const free = (c) => {
    if (known.has(c.id)) return false;
    const s = nState(c.key);
    return s === null || s === 'waiting' || s === 'round';
  };
  const claim = (round, c, { late = false } = {}) => {
    const item = itemOf(c, { late });
    round.items.push(item);
    known.add(item.id);
    if (c.key) { claimed.push(c.key); if (nState(c.key) === 'waiting') takeFromN.push(c.key); }
    if (ms(c.at) && ms(c.at) > (ms(round.lastItemAt) ?? 0)) round.lastItemAt = c.at;
    changed.add(round.round);
    return item;
  };
  let next = Math.max(0, ...all.map((r) => r.round)) + 1;
  const open = (author) => all.filter((r) => r.prNumber === pr.number && r.reviewer === author && GATHERING.has(r.state)).at(-1) ?? null;
  const hadRound = (author) => all.some((r) => r.prNumber === pr.number && r.reviewer === author);
  const startRound = (author, first) => {
    const r = newRound({ number: next++, prNumber: pr.number, route: pr.route, prLabel: pr.label, prUrl: pr.url, author, first, head, at });
    all.push(r);
    changed.add(r.round);
    return r;
  };

  let list = candidates.filter(free);
  if (firstLook) {
    // Only the reviewer's latest word, still "Request changes", on the newest commit.
    const latest = new Map();
    for (const c of candidates) if (c.type === 'review' || c.reviewId) latest.set(c.author, c);
    const keep = new Set([...latest.values()].filter((c) => c.reviewState === 'CHANGES_REQUESTED' && (!head || !c.commit || c.commit === head) && decision !== 'approved').map((c) => c.reviewId));
    list = list.filter((c) => c.reviewId && keep.has(c.reviewId));
  }

  const byAuthor = new Map();
  for (const c of list) byAuthor.set(c.author, [...(byAuthor.get(c.author) ?? []), c]);
  for (const [author, mine] of byAuthor) {
    let pending = [];
    const flush = () => { pending = []; };
    for (const c of mine) {
      const r = open(author);
      if (r) {
        // A round the Foreman is already on: the item waits for your yes to join its list.
        claim(r, c, { late: r.state === 'fixing' });
        if (r.state === 'left') { r.state = 'asked'; r.timeline.push({ at, words: `${cap(author)} commented again, so the round is back.` }); }
        continue;
      }
      if (pending.length && ms(c.at) !== null && ms(pending.at(-1).at) !== null && ms(c.at) - ms(pending.at(-1).at) > JOIN_MS) flush();
      pending.push(c);
      const qualifies = pending.some((p) => p.reviewState === 'CHANGES_REQUESTED') || pending.length >= 2 || hadRound(author);
      if (!qualifies) continue;
      const round = startRound(author, pending.find((p) => p.reviewState) ?? pending[0]);
      for (const p of pending) claim(round, p);
      flush();
    }
  }

  // Failed checks on the newest commit: they join this PR's gathering round on that commit, or
  // re-open a round that went back with that commit.
  const failed = (checks ?? []).filter((c) => c?.state === 'fail');
  if (failed.length && head) {
    const gathering = all.filter((r) => r.prNumber === pr.number && GATHERING.has(r.state) && (!r.head || r.head === head)).at(-1) ?? null;
    const sentWith = all.filter((r) => r.prNumber === pr.number && ['sent', 'check-failed'].includes(r.state) && r.sentHead === head).at(-1) ?? null;
    const target = gathering ?? sentWith;
    if (target) {
      for (const c of failed) {
        const cand = checkCandidate(pr.number, c, head);
        const id = itemOf(cand).id;
        if (roundHas(target, id)) continue;
        const s = nState(cand.key);
        if (s && !['waiting', 'round'].includes(s)) continue;
        claim(target, { ...cand, id, at }, { late: target.state === 'fixing' });
        if (target === sentWith && target.state === 'sent') {
          target.state = 'check-failed';
          target.timeline.push({ at, words: `${clean(c.name)} failed on the push.` });
        }
      }
    }
  }
  return { rounds: all, changed: [...changed], claimed, takeFromN };
}

// ---------- The Foreman's report (status.json prs[k].rounds) ----------

const FOREMAN_ITEM_STATES = new Set(['todo', 'working', 'fixed', 'answered', 'wont_change']);
const PLANS = new Set(['fix', 'answer', 'wont_change']);

/**
 * The Foreman's report for this round (parsed status.json prs[k].rounds[i], lib/status-json.js),
 * folded into the round: each item's kind (unless you chose it), plan, state, commit and drafted
 * reply (unless you edited it), and the round's doing / next / checks lines. Returns whether
 * anything changed.
 */
export function applyForeman(round, report, { at = new Date().toISOString() } = {}) {
  if (!report || report.round !== round.round) return false;
  const before = JSON.stringify([round.items, round.foreman]);
  // Only what changed since the last report is taken: your own change (Change it after all, a kind
  // you picked) stands until the Foreman reports that item again.
  const sig = JSON.stringify(report);
  if (round.foremanSig !== sig) {
    round.foreman = { state: report.state ?? null, doing: report.doing ?? null, next: report.next ?? null, checks: report.checks ?? null, at: round.foreman?.at ?? at };
    round.foremanSig = sig;
  }
  for (const r of report.items ?? []) {
    const item = round.items.find((i) => i.id === r.id);
    if (!item) continue;
    const isig = JSON.stringify(r);
    if (item.reportSig === isig) continue;
    item.reportSig = isig;
    if (r.kind && KINDS.includes(r.kind) && item.kindBy !== 'you' && item.type !== 'check') { item.kind = r.kind; item.kindBy = 'foreman'; }
    if (r.plan && PLANS.has(r.plan)) item.plan = r.plan;
    if (r.planText != null) item.planText = cut(r.planText, 400);
    if (!item.included) continue;
    if (r.state && FOREMAN_ITEM_STATES.has(r.state)) item.state = r.state;
    if (r.commit) item.commit = String(r.commit).slice(0, 40);
    if (r.reason != null) item.reason = cut(r.reason, 1000);
    if (r.reply != null && !item.replyEdited && !noReply(item)) item.reply = cut(r.reply, QUOTE_MAX);
  }
  const after = JSON.stringify([round.items, round.foreman]);
  if (before !== after && round.foreman) round.foreman.at = at;
  return before !== after;
}

/** Whether the Foreman is done with the round: it says ready and every included item has an end state. */
export function foremanReady(round) {
  if (round.foreman?.state !== 'ready') return false;
  return round.items.filter((i) => i.included && i.added).every((i) => ['fixed', 'answered', 'wont_change'].includes(i.state));
}

// ---------- The files ----------

const dirOf = (featureDir) => path.join(featureDir, ROUNDS_DIR);

/** Every round of the job, oldest first. Missing or unreadable files are skipped. */
export async function readRounds(featureDir) {
  let names = [];
  try { names = await fs.readdir(dirOf(featureDir)); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!/^round-\d+\.json$/.test(n)) continue;
    try {
      const r = JSON.parse(await fs.readFile(path.join(dirOf(featureDir), n), 'utf8'));
      if (isRecord(r) && Number.isInteger(r.round) && Array.isArray(r.items)) out.push(r);
    } catch { /* a half-written file: the next save writes it whole */ }
  }
  return out.sort((a, b) => a.round - b.round);
}

/** Write one round: round-<n>.json and round-<n>.md, each whole through a temporary file. */
export async function saveRound(featureDir, round, { route = [] } = {}) {
  await fs.mkdir(dirOf(featureDir), { recursive: true });
  const clean = scrubDeep(round);
  for (const [name, text] of [[`round-${round.round}.json`, `${JSON.stringify(clean, null, 2)}\n`], [`round-${round.round}.md`, roundMarkdown(clean, { route })]]) {
    const file = path.join(dirOf(featureDir), name);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  }
}

const STATE_WORDS = { todo: 'To do', working: 'Working on it', fixed: 'Fixed', answered: 'Answered', wont_change: 'Won’t change', left_out: 'Left out' };

/** One item's state in words: "Fixed in a1b2c3d", "Won’t change", "Left out". */
export function itemStateWords(item) {
  if (!item.included) return STATE_WORDS.left_out;
  if (item.state === 'fixed' && item.commit) return `Fixed in ${short(item.commit)}`;
  return STATE_WORDS[item.state] ?? STATE_WORDS.todo;
}

const whereWords = (i) => (i.file ? `${i.file}${i.line ? ` line ${i.line}` : ''}${i.outdated ? ' (outdated: the line has changed since)' : ''}` : i.type === 'check' ? `the ${i.name} check` : 'the whole pull request');

/** round-<n>.md: the round as the Foreman and a person read it. */
export function roundMarkdown(round, { route = [] } = {}) {
  const who = nameFor(round.reviewer, route);
  const lines = [
    `# Round ${round.round} · ${round.prLabel ?? `PR #${round.pr}`}`,
    '',
    `From ${who}’s review${round.reviewAt ? ` at ${clock(round.reviewAt)}` : ''}${round.reviewState === 'CHANGES_REQUESTED' ? ' (Request changes)' : ''}. State: ${round.state}.`,
    '',
    'Each item has an id: use it in status.json prs[k].rounds[].items[].id. Items marked "left out" are not to be worked on.',
    '',
  ];
  if (round.note) lines.push(`A note from the person: ${round.note}`, '');
  for (const i of round.items) {
    lines.push(`## ${i.id} · ${KIND_WORDS[i.kind] ?? i.kind} · ${itemStateWords(i)}${i.late && !i.added ? ' · new, waiting for a yes' : ''}`);
    lines.push('', `Where: ${whereWords(i)}${i.author ? ` · from ${i.author}` : ''}${i.link ? ` · ${i.link}` : ''}`, '');
    if (i.quote) lines.push(...i.quote.split('\n').map((l) => `> ${l}`), '');
    if (i.log) lines.push('The end of its log:', '', '```', i.log, '```', '');
    if (i.planText) lines.push(`Plan: ${i.planText}`, '');
    if (i.reply) lines.push(`Reply${i.replyDropped ? ' (dropped: not posted)' : ''}: ${i.reply}`, '');
    if (i.reason) lines.push(`Why not: ${i.reason}`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

// ---------- What the Foreman is sent ----------

function fenced(text) {
  const longest = Math.max(0, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/**
 * The message for "Fix with the Foreman" (kind 'review-round'): the whole round, the included items
 * only, with what to do first (a plan per item, written to status.json before any change), how to
 * work (one commit per item or small group, naming the comment; the profile's checks), the replies
 * to draft, and what not to do (push, reply, merge: those wait for Send back). checks: the
 * profile's check commands. what: 'fix' | 'checks' (a check failed after the push) | 'sync' (bring
 * in the base) | 'more' (new items joined the round).
 */
export function foremanMessage(round, { route = [], checks = [], what = 'fix', base = 'staging', roundFile = null } = {}) {
  const who = nameFor(round.reviewer, route);
  const label = round.prLabel ?? `PR #${round.pr}`;
  const items = round.items.filter((i) => i.included && i.added && !['fixed', 'answered', 'wont_change'].includes(i.state));
  const out = [];
  if (what === 'sync') {
    out.push(`${label} conflicts with ${base}. Bring ${base} into this branch with the ship skill's "Sync" procedure (skills/ship/staging-conflicts.md): merge ${base} in, never rebase, resolve each conflict, run the checks, and commit the merge. Don't push: that waits for Send back, like a review round.`);
  } else {
    const intro = what === 'checks' ? `A check failed on ${label} after round ${round.round} went back.` : what === 'more' ? `New items joined round ${round.round} on ${label}.` : `${who} asked for changes on ${label}: this is round ${round.round}.`;
    out.push(`${intro} Work through the items below on this branch (skills/ship/review-rounds.md has the steps and the reply style).`);
  }
  if (round.note) out.push(`A note from the person: ${clean(round.note)}`);
  if (what !== 'sync') {
    out.push([
      '1. First say what you will do with each item, before changing anything: write status.json prs[k].rounds with this round, state "planning", and per item its id, kind (change, question, nit or check), plan (fix, answer or wont_change) and plan_text.',
      '2. Then fix them on this branch in the job’s worktree, one commit per item or per small group; each commit message names the comment it answers. Set the round to "fixing" and each item to "working", then "fixed" with its commit.',
      `3. Run the checks${checks.length ? ` (${checks.join('; ')})` : ''} and the tests the change touches. Say what ran in the round's "checks" line.`,
      '4. Draft a reply for every comment, short, polite and specific: "Fixed in a1b2c3d: renamed to feedbackId." / "Kept as it is: … because …" / the answer to a question. Write it as the item’s "reply". A failed check gets no reply.',
      '5. When every item is done, set the round to "ready".',
      'Don’t push, don’t reply on GitHub, and don’t merge: Send back does those, after the person says go.',
    ].join('\n'));
  }
  for (const i of items) {
    const head = `${i.id} · ${KIND_WORDS[i.kind] ?? i.kind} · ${whereWords(i)}`;
    if (i.type === 'sync') out.push(`${head}\n${i.quote}`);
    else if (i.type === 'check') out.push(`${head}\nThe end of its log:\n${i.log ? fenced(i.log) : '(Its log couldn’t be read. Look at the check on GitHub, read only.)'}${i.link ? `\nThe check on GitHub: ${i.link}` : ''}`);
    else out.push(`${head} · from ${clean(i.author)}\n${i.quote.split('\n').map((l) => `> ${l}`).join('\n')}${i.link ? `\nOn GitHub: ${i.link}` : ''}`);
  }
  const left = round.items.filter((i) => !i.included);
  if (left.length) out.push(`Left out by the person, not to be worked on: ${left.map((i) => i.id).join(', ')}.`);
  if (roundFile) out.push(`The round is also in ${roundFile}.`);
  return out.join('\n\n');
}

// ---------- The view: one job's review state, each with its one next action, in words ----------

const action = (id, label, { key = null, go = null, playLabel = null, enabled = true, reason = null, client = false, confirm = null } = {}) => ({ id, label, playLabel: playLabel ?? (go === true ? `Go: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : go === false ? `No go: ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label), key, go, enabled, reason, client, confirm });

/** "4 comments, 1 question": a round's comments (changes and nits) and questions. */
export function countWords(items) {
  const comments = items.filter((i) => !noReply(i) && i.kind !== 'question').length;
  const questions = items.filter((i) => !noReply(i) && i.kind === 'question').length;
  return listWords([comments ? plural(comments, 'comment') : null, questions ? plural(questions, 'question') : null].filter(Boolean)).replace(' and ', ', ') || 'no comments';
}

const checkNames = (items) => listWords(items.filter((i) => i.type === 'check').map((i) => i.name));
/** Items that get no reply on GitHub: a failed check, bringing in the base. */
export const noReply = (i) => i.type === 'check' || i.type === 'sync';

// Group the panel's items by file, the whole-PR ones next, the checks last.
function groupsOf(items) {
  const groups = new Map();
  for (const i of items) {
    const key = i.type === 'check' ? '\u0002checks' : i.type === 'sync' ? '\u0000sync' : i.file ?? '\u0001general';
    if (!groups.has(key)) groups.set(key, { heading: i.type === 'check' ? 'Checks on the same commit' : i.type === 'sync' ? 'Bringing in the base' : i.file ?? 'On the whole pull request', file: noReply(i) ? null : i.file ?? null, items: [] });
    groups.get(key).items.push(i);
  }
  return [...groups.entries()].sort(([a], [b]) => (a.startsWith('\u0002') ? 1 : 0) - (b.startsWith('\u0002') ? 1 : 0) || (a.startsWith('\u0001') ? 1 : 0) - (b.startsWith('\u0001') ? 1 : 0) || a.localeCompare(b)).map(([, g]) => g);
}

function replyState(i) {
  if (noReply(i)) return null;
  if (i.posted?.ok) return 'Posted';
  if (i.posted && !i.posted.ok) return 'Didn’t post';
  if (i.replyDropped) return 'Dropped';
  return 'Not posted yet';
}

/** The panel's round: header, items grouped by file (checks last), each with its state in words. */
export function roundPanel(round, { route = [] } = {}) {
  const who = nameFor(round.reviewer, route);
  const added = round.items.filter((i) => i.added);
  const checks = added.filter((i) => i.type === 'check');
  const fromWords = `From ${who}’s review at ${clock(round.reviewAt)}${round.reviewState === 'CHANGES_REQUESTED' ? ' (Request changes)' : ''}${checks.length ? ` and the ${checkNames(checks)} check${checks.length > 1 ? 's' : ''} on the same commit` : ''}`;
  const view = (i) => ({
    id: i.id, type: i.type, kind: i.kind, kindWords: KIND_WORDS[i.kind] ?? i.kind, kindBy: i.kindBy, author: i.author ?? null, file: i.file, line: i.line, outdated: Boolean(i.outdated),
    outdatedWords: i.outdated ? 'Outdated: the line has changed since' : null, quote: i.quote, name: i.name ?? null, link: i.link, at: i.at,
    included: i.included, state: i.included ? i.state : 'left_out', stateWords: itemStateWords(i), commit: short(i.commit), plan: i.plan, planText: i.planText,
    reply: noReply(i) ? null : i.reply, replyDropped: Boolean(i.replyDropped), replyState: replyState(i), reason: i.reason,
    late: Boolean(i.late), newWords: i.late && !i.added ? `New · joined round ${round.round}` : null,
    changeAfterAll: i.included && i.state === 'wont_change' ? action('change-after-all', 'Change it after all', { go: null }) : null,
  });
  const included = added.filter((i) => i.included).length;
  const done = added.filter((i) => i.included && ['fixed', 'answered', 'wont_change'].includes(i.state)).length;
  return {
    round: round.round, pr: round.pr, prLabel: round.prLabel, state: round.state, title: `Round ${round.round} · ${round.prLabel}`,
    from: fromWords, reviewer: { login: round.reviewer, name: who },
    counts: { items: added.length, included, done, commits: new Set(added.filter((i) => i.commit).map((i) => i.commit)).size, replies: added.filter((i) => i.included && i.reply && !noReply(i)).length },
    includedWords: `${included} of ${added.length} included`,
    kindsWords: 'Kinds are the Foreman’s first guess: click one to change it.',
    footer: 'The Foreman fixes, commits and drafts replies on this job’s own branch. It doesn’t push, reply or merge: that waits for Send back.',
    note: round.note, groups: groupsOf(round.items).map((g) => ({ ...g, items: g.items.map(view) })),
    pending: round.items.filter((i) => i.late && !i.added).map(view),
    foreman: round.foreman ? { state: round.foreman.state, doing: round.foreman.doing, next: round.foreman.next, checks: round.foreman.checks } : null,
    timeline: (round.timeline ?? []).map((t) => ({ at: t.at, time: clock(t.at), words: t.words })),
    timelineHeading: `Round ${round.round}, start to end`,
  };
}

/**
 * The steps Send back will run, in order, in words, before the button (Send back's plan).
 * ctx: { ahead (commits not on the fork yet), fork (remote name), branch, orgRemote, twoStep,
 * followUp (an open follow-up PR #1, or null), mergeFollowUp (true: this go merges it too) }.
 */
export function sendPlan(round, ctx = {}, { route = [] } = {}) {
  const who = nameFor(round.reviewer, route);
  const label = round.prLabel ?? `PR #${round.pr}`;
  const items = round.items.filter((i) => i.included && i.added);
  const steps = [];
  const ahead = ctx.ahead ?? 0;
  if (ahead > 0) steps.push({ id: 'push', words: `Push ${plural(ahead, 'commit')} to your fork`, detail: `git push ${ctx.fork ?? 'origin'} ${ctx.branch ?? '<branch>'} · never forced` });
  const viaFollowUp = ahead > 0 && ctx.twoStep && round.pr === 2;
  if (viaFollowUp) {
    const org = ctx.orgRemote ?? 'org';
    const merge = ctx.mergeFollowUp !== false;
    const opening = ctx.followUp ? `PR #${round.pr} is ${who}’s, from the ${org} branch: the follow-up PR #1 (#${ctx.followUp.number}) is open already` : `PR #${round.pr} is ${who}’s, from the ${org} branch: open the follow-up PR #1, your fork → the ${org} branch`;
    steps.push({
      id: 'follow-up',
      words: merge ? `${opening}, and merge it once its checks pass` : `${opening}, and stop there`,
      detail: `“${followUpTitle(round, route)}” · body from pr-body.md · then ${label} shows the ${plural(ahead, 'new commit')}`,
      choice: merge ? 'This go also merges PR #1 once its checks pass · or I’ll merge PR #1 myself' : 'I’ll merge PR #1 myself. Steps 3 to 5 run as soon as it’s merged (GitHub is checked every minute).',
      mergeFollowUp: merge,
    });
  }
  const replies = items.filter((i) => !noReply(i) && i.reply && !i.replyDropped && !i.posted?.ok);
  const checkItems = items.filter((i) => i.type === 'check');
  if (replies.length) steps.push({ id: 'replies', words: `Reply on GitHub to each of ${who}’s ${plural(replies.length, 'comment')}`, detail: `Each drafted reply below: edit or drop any of them.${checkItems.length ? ` The ${checkNames(checkItems)} check${checkItems.length > 1 ? 's get' : ' gets'} no reply; the push runs ${checkItems.length > 1 ? 'them' : 'it'} again.` : ''}`, count: replies.length });
  const resolve = items.filter((i) => i.type === 'line' && i.state === 'fixed' && !i.resolved);
  if (resolve.length) steps.push({ id: 'resolve', words: `Mark the ${plural(resolve.length, 'fixed comment')} resolved`, detail: 'Only the ones Fixed: not the answered question or the one kept as it is', count: resolve.length });
  const reviewer = routeStep(route, round.pr).reviewer;
  if (round.reviewer && !reviewer?.you && !round.requestedAt && !round.sync) steps.push({ id: 'request', words: `Ask ${who} to review ${label} again`, detail: `gh pr edit · re-request review from ${who}` });
  return steps.map((s, i) => ({ ...s, number: i + 1 }));
}

export const followUpTitle = (round, route = []) => `Follow-up for ${nameFor(round.reviewer, route)}’s review on ${round.prLabel ?? `PR #${round.pr}`}`;

/** The follow-up PR #1's body (skills/ship/pr-body.md "Follow-up PR #1"). commits: [{ sha, subject }]. */
export function followUpBody(round, { route = [], commits = [], prUrl = null, decisions = null } = {}) {
  const who = nameFor(round.reviewer, route);
  const label = round.prLabel ?? `PR #${round.pr}`;
  const fixed = round.items.filter((i) => i.included && i.added && i.state === 'fixed');
  return [
    `Follow-up for ${who}’s review on ${label}${prUrl ? ` (${prUrl})` : ''}, round ${round.round}.`,
    '',
    '## What changed',
    ...(commits.length ? commits.map((c) => `- ${short(c.sha)} ${clean(c.subject)}`) : ['- (no commits listed)']),
    '',
    '## Answers',
    ...(fixed.length ? fixed.map((i) => `- ${i.file ? `${i.file}${i.line ? `:${i.line}` : ''}` : i.type === 'check' ? `the ${i.name} check` : 'the review'}: fixed${i.commit ? ` in ${short(i.commit)}` : ''}`) : ['- No code changes.']),
    '',
    `The replies to each comment are on ${label}. Merging this brings the fixes onto ${label}.`,
    ...(decisions ? ['', `Decisions: ${decisions}`] : []),
  ].join('\n');
}

const STEP_STATE_WORDS = { will: 'Will do', working: 'Working', done: 'Done', stopped: 'Stopped here', 'not-run': 'Not run', 'after-pr1': 'After PR #1 is merged', skipped: 'Not needed' };

/** Send back's steps with their states in words (round.send.steps, or the plan before the go). */
export const stepsView = (steps) => steps.map((s) => ({ ...s, stateWords: STEP_STATE_WORDS[s.state ?? 'will'] ?? s.state }));

/**
 * One job's review state, drawn by the panel on the Ship stop, the Desk card and the Jobs card.
 * ctx: { job: { slug, title }, pr: the PR under review (number, label, url, state, review,
 * checks, mergeable, reviewRequests, mergedAt, mergedBy, closedAt, closedBy, closeReason,
 * approvedAt, base, head, draft), round: the current round (or null), route, runActive (the
 * Foreman is replying now), lock (held elsewhere, or null), plan: Send back's steps for a ready
 * round, approvalReset, now, stagingNext ("staging QA, then PR #3 with the release") }.
 * Returns { state, bar: { headline, detail, actions }, desk | null, card, phone, round, send,
 * merge, remind }. state is one of: asked, left, fixing, fix-stalled, new-comment, ready, sending,
 * stopped, after-pr1, waiting, check-failed, conflicts, approval-reset, no-reviewer, closed,
 * approved-they-merge, approved-you-merge, merged, held, or null (nothing to show).
 */
export function reviewView(ctx) {
  const { job = {}, pr = null, round = null, route = [], runActive = false, lock = null, now = Date.now() } = ctx;
  if (!pr) return null;
  const label = pr.label ?? `PR #${pr.number}`;
  const step = routeStep(route, pr.routeNumber ?? round?.pr ?? 1);
  const reviewerLogin = round?.reviewer ?? pr.lastReviewer ?? step.reviewer?.login ?? null;
  const who = reviewerLogin ? nameFor(reviewerLogin, route) : step.reviewer && !step.reviewer.you ? step.reviewer.name : 'the reviewer';
  const nowIso = new Date(now).toISOString();
  const panel = round ? roundPanel(round, { route }) : null;
  const out = { slug: job.slug ?? null, state: null, bar: null, desk: null, card: null, phone: null, round: panel, send: null, merge: null, remind: null, held: null, pr: { ...pr, label } };
  const items = round ? round.items.filter((i) => i.added) : [];
  const set = (state, bar, { desk = null, card = null, phone = null } = {}) => Object.assign(out, { state, bar, desk, card: card ?? { line: bar.headline, place: `Ship · ${label}${round ? ` · round ${round.round}` : ''}` }, phone: phone ?? bar.headline });
  const deskOf = (bar, sentence) => ({ headline: bar.headline, sentence, actions: bar.actions.filter((a) => a.go !== null) });
  const openRound = action('open', 'Open the round', { key: 'o', client: true });
  const openPr = action('open-pr', `Open ${label}`, { key: 'p', client: true });

  if (pr.state === 'merged') {
    const by = pr.mergedBy ? nameFor(pr.mergedBy, route) : null;
    set('merged', { headline: `${label} is merged into ${pr.base ?? step.into ?? 'its base'}`, detail: `Merged${by ? ` by ${by}` : ''} at ${clock(pr.mergedAt, nowIso)}.${ctx.stagingNext ? ` Next on the route: ${ctx.stagingNext}.` : ''}`, actions: [action('open-base', `Open ${pr.base ?? 'the base branch'}`, { key: 'o', client: true })] }, { card: { line: `${label} merged`, place: `Ship · ${label}` } });
    return out;
  }
  if (pr.state === 'closed') {
    const by = pr.closedBy ? nameFor(pr.closedBy, route) : null;
    const bar = { headline: `${label} was closed without merging`, detail: `Closed${by ? ` by ${by}` : ''} at ${clock(pr.closedAt, nowIso)}${pr.closeReason ? `: “${cut(pr.closeReason, 200)}”` : ''}. Your branch and its commits are kept.`, actions: [action('reopen', `Reopen ${label}`, { key: 'a', go: true }), action('drop', 'Mark the job dropped', { key: 'r', go: false, client: true })] };
    set('closed', bar, { desk: deskOf(bar, 'Reopen it to carry on, or mark the job dropped. Nothing else changes.') });
    return held(out, lock, job);
  }

  const rs = round?.state ?? null;
  const late = round ? round.items.filter((i) => i.late && !i.added) : [];
  if (rs === 'sending') {
    const steps = round.send?.steps ?? [];
    const at = steps.findIndex((s) => s.state === 'working');
    const n = at >= 0 ? at + 1 : steps.filter((s) => s.state === 'done').length + 1;
    const doing = steps[at] ?? null;
    set('sending', { headline: `Sending round ${round.round} back: step ${Math.min(n, steps.length)} of ${steps.length}`, detail: `${doing?.waiting ?? doing?.words ?? 'Working.'} Each step is in the job’s history as it happens.`, actions: [action('stop-after-step', 'Stop after this step', { enabled: !round.send?.stopAfter, reason: round.send?.stopAfter ? 'It stops once this step is done.' : null })] });
    out.send = { steps: stepsView(steps), stopAfter: Boolean(round.send?.stopAfter), mergeFollowUp: round.send?.mergeFollowUp !== false };
    return out;
  }
  if (rs === 'stopped') {
    const steps = round.send?.steps ?? [];
    const failed = steps.find((s) => s.state === 'stopped');
    const done = steps.filter((s) => s.state === 'done');
    const notRun = steps.filter((s) => s.state === 'not-run');
    const posted = items.filter((i) => i.posted?.ok).length;
    const headline = failed ? `Stopped at step ${failed.number}: ${failed.failWords ?? failed.words}` : `Round ${round.round} stopped after step ${done.length}`;
    // "GitHub had a problem (502). Steps 1 and 2 are done, 3 replies are posted, and steps 4 and 5 didn’t run."
    const why = failed?.error ? (failed.code ? `GitHub had a problem (${failed.code}).` : `It didn’t work: ${cut(failed.error, 300).replace(/[.\s]+$/, '')}.`) : round.send?.stopAfter ? 'You asked it to stop after that step.' : null;
    const parts = [
      done.length ? `${done.length === 1 ? 'step' : 'steps'} ${listWords(done.map((s) => String(s.number)))} ${done.length === 1 ? 'is' : 'are'} done` : null,
      posted ? `${plural(posted, 'reply', 'replies')} ${posted === 1 ? 'is' : 'are'} posted` : null,
      notRun.length ? `${notRun.length === 1 ? 'step' : 'steps'} ${listWords(notRun.map((s) => String(s.number)))} didn’t run` : null,
    ].filter(Boolean);
    const rest = parts.length > 2 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts.join(' and ');
    const detail = [why, rest ? `${cap(rest)}.` : null].filter(Boolean).join(' ');
    const bar = { headline, detail, error: failed?.error ?? null, actions: [action('retry', 'Try again from here', { key: 'a', go: true }), action('not-yet', 'Not yet', { key: 'r', go: false })] };
    set('stopped', bar, { desk: deskOf(bar, 'Nothing that is done runs again: posted replies are never posted twice.') });
    out.send = { steps: stepsView(steps), stopAfter: Boolean(round.send?.stopAfter), mergeFollowUp: round.send?.mergeFollowUp !== false };
    return held(out, lock, job);
  }
  if (rs === 'after-pr1') {
    const fu = round.followUp;
    set('after-pr1', { headline: `Waiting for you to merge the follow-up PR #1${fu?.number ? ` (#${fu.number})` : ''}`, detail: `You said you’d merge it yourself. Steps 3 to 5 run as soon as it’s merged (GitHub is checked every minute).`, actions: [action('open-follow-up', 'Open the follow-up PR #1', { key: 'p', client: true, enabled: Boolean(fu?.url) }), action('merge-follow-up', 'Merge it from here instead', { key: 'a', go: true })] });
    out.send = { steps: stepsView(round.send?.steps ?? []), stopAfter: false, mergeFollowUp: false };
    return held(out, lock, job);
  }
  if (rs === 'asked') {
    const comments = items.filter((i) => i.type !== 'check');
    const checks = items.filter((i) => i.type === 'check');
    const asked = round.reviewState === 'CHANGES_REQUESTED' ? 'asked for changes on' : 'left comments on';
    const headline = `${who} ${asked} ${label} · ${countWords(comments)}`;
    const bar = {
      headline,
      detail: checks.length ? `And ${checkNames(checks)} failed on the same commit.` : null,
      hint: 'Untick anything to leave out, add a note if you like, then say go.',
      actions: [action('fix', 'Fix with the Foreman', { key: 'a', go: true }), action('leave', 'Leave it for now', { key: 'r', go: false }), openRound],
    };
    set('asked', bar, { desk: deskOf(bar, 'Say go and the Foreman says what it will do with each one, then fixes, commits and drafts a reply to each. Nothing goes to GitHub until you say so.'), phone: `${countWords(comments)}${checks.length ? `, and ${checkNames(checks)} failed` : ''}.` });
    return held(out, lock, job);
  }
  if (rs === 'left') {
    set('left', { headline: `Round ${round.round} is left for now`, detail: `${who}’s ${countWords(items.filter((i) => i.type !== 'check'))} wait here. Nothing was sent to the Foreman or to GitHub.`, actions: [action('fix', 'Fix with the Foreman', { key: 'a', go: true }), openRound] });
    return held(out, lock, job);
  }
  if (rs === 'check-failed') {
    const failed = items.filter((i) => i.type === 'check' && i.included && !['fixed'].includes(i.state));
    const total = pr.checkCount ?? null;
    const bar = { headline: `${checkNames(failed) || 'A check'} failed on the push for round ${round.round}`, detail: `${failed.length === 1 ? 'One check' : plural(failed.length, 'check')}${total ? ` out of ${total}` : ''}. The Foreman gets the log and fixes it in the same loop.`, actions: [action('fix-checks', 'Fix with the Foreman', { key: 'a', go: true }), action('leave', 'Leave it for now', { key: 'r', go: false }), openRound] };
    set('check-failed', bar, { desk: deskOf(bar, 'Say go and the Foreman reads the log, fixes it and commits. Nothing is pushed until you say so.') });
    return held(out, lock, job);
  }
  if (rs === 'fixing') {
    if (late.length) {
      const one = late.length === 1;
      const bar = { headline: `${who} added ${one ? 'a comment' : plural(late.length, 'comment')} while the Foreman works on round ${round.round}`, detail: `${one ? 'It joins' : 'They join'} round ${round.round}, since round ${round.round} hasn’t gone back yet. Say yes and the Foreman takes ${one ? 'it' : 'them'} after the item it’s on.`, actions: [action('add-new', 'Add it to the Foreman’s list', { key: 'a', go: true }), action('leave-new', 'Leave it out', { key: 'r', go: false }), openRound] };
      set('new-comment', bar, { desk: deskOf(bar, 'Nothing else changes: the Foreman carries on with the round.') });
      return held(out, lock, job);
    }
    if (foremanReady(round) && !runActive) return readyView(out, { round, items, who, label, ctx, set, deskOf, route, lock, job });
    const included = items.filter((i) => i.included);
    const done = included.filter((i) => ['fixed', 'answered', 'wont_change'].includes(i.state)).length;
    const commits = new Set(included.filter((i) => i.commit).map((i) => i.commit)).size;
    const replies = included.filter((i) => i.reply && i.type !== 'check').length;
    const planning = !round.foreman || round.foreman.state === 'planning' || included.every((i) => !i.plan);
    const sendAction = action('send', `Send back to ${who}`, { key: 'a', go: true, enabled: false, reason: 'The Foreman is still on it.' });
    if (!runActive) {
      set('fix-stalled', { headline: `The Foreman stopped before round ${round.round} was ready`, detail: `${done} of ${included.length} done${commits ? ` · ${plural(commits, 'commit')} so far` : ''}. Ask it to carry on with the rest.`, actions: [action('fix', 'Ask the Foreman to carry on', { key: 'a', go: true }), openRound] }, { desk: null });
      out.desk = deskOf(out.bar, 'It picks up where it stopped, with the same round.');
      return held(out, lock, job);
    }
    set('fixing', {
      headline: planning ? `The Foreman is on round ${round.round}` : `The Foreman is on round ${round.round}: ${done} of ${included.length} done`,
      detail: planning ? 'It is reading the round and saying what it will do with each item.' : `It has planned all ${included.length}. Now it fixes them one at a time, one commit each, and runs the checks. We’ll tell you when it’s ready to send back.`,
      progress: `${done} of ${included.length} done · ${plural(commits, 'commit')} so far`, replies: `Replies drafted for ${replies}`,
      doing: round.foreman?.doing ?? null, next: round.foreman?.next ?? null, phase: planning ? 'plan' : 'working',
      actions: [sendAction, openRound],
    }, { card: { line: `The Foreman is on round ${round.round}: ${done} of ${included.length} done`, place: `Ship · ${label} · round ${round.round}` } });
    return held(out, lock, job);
  }

  // The PR's own state, between rounds and after one went back.
  const sent = rs === 'sent' ? round : null;
  if (pr.mergeable === 'CONFLICTING') {
    const files = pr.conflictFiles ?? null;
    const bar = { headline: `${label} conflicts with ${pr.base ?? 'its base'}${files ? ` in ${plural(files, 'file')}` : ''}`, detail: `${pr.base ?? 'The base'} changed under ${label}. ${cap(pr.base ?? 'the base')} is merged in, never rebased, so nothing has to be force-pushed.`, actions: [action('sync', `Bring in ${pr.base ?? 'the base'} with the Foreman`, { key: 'a', go: true }), openPr] };
    set('conflicts', bar, { desk: deskOf(bar, 'The Foreman merges it in on this branch and commits; then Send back pushes it, after your go.') });
    return held(out, lock, job);
  }
  const reviewerYou = step.reviewer?.you ?? false;
  const checksGreen = pr.checks === 'passing' || pr.checks === null;
  const approved = pr.review === 'approved' || (reviewerYou && pr.review !== 'changes_requested');
  if (approved && checksGreen && ['open'].includes(pr.state)) {
    const merger = step.merger;
    const youMerge = step.youMayMerge || merger?.you;
    const mergerName = merger && !merger.you ? merger.name : null;
    out.merge = { who: youMerge ? 'you' : mergerName ?? 'not named', line: `${youMerge ? 'you' : mergerName ?? 'not named'} · from the route (${whoMergesLine(route)})`, method: step.squash ? 'squash' : 'merge', command: `gh pr merge ${pr.number} --repo ${pr.repo ?? '<repo>'} --${step.squash ? 'squash' : 'merge'}` };
    if (youMerge) {
      const bar = { headline: `${label} is ${reviewerYou ? 'ready' : 'approved'} and green: merge it into ${pr.base ?? step.into ?? 'its base'}?`, detail: `${step.words ? 'The route' : 'Nothing in the route says otherwise, so it'} lets you merge ${label}. It always asks first: a merge is a hard line.`, actions: [action('merge', `Merge ${label}…`, { key: 'm', go: null, confirm: { headline: `Merge ${label} into ${pr.base ?? 'its base'}?`, hardLine: 'Hard line', step: out.merge.command, go: action('merge', `Merge ${label}`, { key: null, go: true, playLabel: `Go: merge ${label}` }), noGo: action('cancel', 'Not now', { key: 'Escape', go: false }), keyNote: 'The a key never merges.' } }), openPr] };
      set('approved-you-merge', bar, { desk: deskOf({ ...bar, actions: bar.actions }, 'Ready to merge. You merge it here, after one more yes.'), card: { line: `Ready to merge · you merge ${label}`, place: `Ship · ${label}` } });
      out.desk.actions = [bar.actions[0]];
      return held(out, lock, job);
    }
    const since = ms(pr.approvedAt) ?? now;
    const remindAt = since + REMIND_AFTER_MS;
    const canRemind = now >= remindAt && !(ctx.remindedAt && now - ms(ctx.remindedAt) < REMIND_AFTER_MS);
    const name = mergerName ?? who;
    out.remind = {
      at: new Date(remindAt).toISOString(), can: canRemind,
      text: remindText({ name, label, title: job.title, ticket: job.ticket, base: pr.base ?? step.into }),
      note: 'Posted as a comment from you, on GitHub, exactly as written here. Edit it first if you like.',
    };
    set('approved-they-merge', { headline: `Waiting for ${name} to merge ${label}`, detail: `Approved, checks green. ${name} merges ${label}, so there’s nothing for you to do. Remind ${name} is there from ${clock(out.remind.at, nowIso)}, a day after the approval.`, actions: [action('remind', `Remind ${name}…`, { key: 'a', go: null, enabled: canRemind, reason: canRemind ? null : `From ${clock(out.remind.at, nowIso)}, a day after the approval.` }), openPr] }, { card: { line: `Ready to merge · ${name} merges it`, place: `Ship · ${label}` } });
    return held(out, lock, job);
  }
  if (approved && pr.checks === 'pending') {
    set('waiting', { headline: `Approved: waiting on the checks for ${label}`, detail: 'Nothing for you to do: GitHub is checked every minute while you wait.', on: 'checks', actions: [openPr] });
    return out;
  }
  if (ctx.approvalReset && pr.review === 'review_required') {
    set('approval-reset', { headline: `Approval reset by your push: waiting on ${who} again`, detail: `GitHub drops approvals on new commits in this repository. ${who} has been asked again; nothing for you to do.`, on: 'reviewer', actions: [openPr] }, { card: { line: `Approval reset by your push: waiting on ${who} again`, place: `Ship · ${label}` } });
    return out;
  }
  const named = step.reviewer && !step.reviewer.you ? step.reviewer : null;
  const nobodyAsked = pr.state === 'open' && pr.review === 'review_required' && !(pr.reviewRequests ?? []).length && !reviewerYou;
  if (nobodyAsked && !sent) {
    const login = named?.login ?? pr.lastReviewer ?? null;
    const bar = { headline: `No one has been asked to review ${label}`, detail: named ? `The route says ${named.name} reviews ${label}. Ask ${/^(he|she|they)$/i.test(named.name) ? 'them' : 'them'}, or pick someone else.` : `The route doesn’t name a reviewer for ${label}. Pick someone.`, actions: [action('ask-review', 'Ask for a review', { key: 'a', go: true })], reviewer: { name: named?.name ?? null, login } };
    set('no-reviewer', bar, { desk: deskOf(bar, 'Their GitHub name is filled in from the route when it has one: check it, then say go.') });
    return held(out, lock, job);
  }
  if (sent) {
    const onChecks = pr.checks === 'pending' && sent.sentHead && pr.head === sent.sentHead;
    const base = onChecks
      ? { headline: `Waiting on the checks for the push of round ${sent.round}`, detail: `Round ${sent.round} went back at ${clock(sent.sentAt, nowIso)}. Nothing for you to do: GitHub is checked every minute while you wait.`, on: 'checks' }
      : { headline: `Waiting on ${who} to review ${label} again`, detail: `Round ${sent.round} went back at ${clock(sent.sentAt, nowIso)}. Nothing for you to do: GitHub is checked every minute while you wait, and you’ll hear as soon as ${who} answers.`, on: 'reviewer' };
    set('waiting', { ...base, actions: [openPr] }, { card: { line: `Waiting on ${onChecks ? 'the checks' : who} since ${clock(sent.sentAt, nowIso)} · round ${sent.round}`, place: `Ship · ${label} · round ${sent.round}` } });
    return out;
  }
  return out;
}

function readyView(out, { round, items, who, label, ctx, set, deskOf, route, lock, job }) {
  const included = items.filter((i) => i.included);
  const fixed = included.filter((i) => i.type !== 'check' && i.state === 'fixed').length;
  const answered = included.filter((i) => i.state === 'answered').length;
  const kept = included.filter((i) => i.state === 'wont_change').length;
  const checks = included.filter((i) => i.type === 'check');
  const questionOnly = (ctx.ahead ?? 0) === 0 && included.every((i) => i.type !== 'check' && i.state !== 'fixed');
  const plan = ctx.plan ?? sendPlan(round, ctx, { route });
  const summary = listWords([fixed ? `${fixed} fixed` : null, answered ? `${answered} answered` : null, kept ? `${kept} kept as it is` : null, checks.length ? `the ${checkNames(checks)} fix` : null].filter(Boolean));
  const checksLine = round.foreman?.checks ? ` ${cut(round.foreman.checks, 300).replace(/([^.])$/, '$1.')}` : '';
  const bar = questionOnly
    ? { headline: `Round ${round.round} is ${included.length === 1 ? 'one question' : countWords(included)}: the answer${included.length === 1 ? ' is' : 's are'} ready`, detail: 'Nothing is pushed and no PR is opened: no code changed in this round.', questionOnly: true, actions: [action('send', `Send the answer${included.length === 1 ? '' : 's'} to ${who}`, { key: 'a', go: true }), action('not-yet', 'Not yet', { key: 'r', go: false }), action('open', 'Open the round', { key: 'o', client: true })] }
    : { headline: `Round ${round.round} is ready to send back`, detail: `${cap(summary) || 'Done'}.${checksLine}`, actions: [action('send', `Send back to ${who}`, { key: 'a', go: true }), action('not-yet', 'Not yet', { key: 'r', go: false }), action('open', 'Open the round', { key: 'o', client: true })] };
  set('ready', bar, { desk: deskOf(bar, 'One go runs every step below, in order, each one in the job’s history. Nothing is force-pushed, ever.') });
  out.send = { steps: stepsView(plan.map((s) => ({ ...s, state: 'will' }))), stopAfter: false, mergeFollowUp: plan.find((s) => s.id === 'follow-up')?.mergeFollowUp ?? null, questionOnly };
  return held(out, lock, job);
}

// The lock is held in a terminal (or another dashboard): the same state, its buttons off.
function held(out, lock, job) {
  if (!lock || !out.bar) return out;
  const reason = 'Send back is off until the terminal lets go.';
  out.held = { pid: lock.pid ?? null, branch: lock.branch ?? null, since: lock.acquiredAt ?? null };
  out.bar = {
    ...out.bar,
    headline: lock.owner === 'terminal' || !lock.owner ? 'This job is being driven from a terminal' : 'This job is being run by another copy of the dashboard',
    detail: `pid ${lock.pid ?? 'unknown'}${lock.branch ? `, branch ${lock.branch}` : ''}, since ${clock(lock.acquiredAt)}. Carry on there, or close it there to send back from here.`,
    was: { headline: out.bar.headline, detail: out.bar.detail },
    actions: out.bar.actions.map((a) => (a.client ? a : { ...a, enabled: false, reason })),
  };
  out.heldState = out.state;
  out.state = 'held';
  if (out.desk) out.desk = { ...out.desk, headline: out.bar.headline, sentence: reason, actions: out.desk.actions.map((a) => ({ ...a, enabled: false, reason })) };
  void job;
  return out;
}

/** The reminder comment, drafted: shown before it is sent, editable. */
export function remindText({ name, label, title, ticket, base }) {
  const what = [title, ticket].filter(Boolean).join(', ');
  return `Hi ${name}, ${label}${what ? ` (${what})` : ''} is approved and its checks are green. Could you merge it${base ? ` into ${base}` : ''} when you get a moment? Thanks!`;
}

/** The job is waiting on someone else (GitHub is checked more often meanwhile). */
export const WAITING_STATES = new Set(['waiting', 'after-pr1', 'approval-reset', 'sending', 'approved-they-merge']);

// ---------- The runner's half: createReviewRounds ----------

const PR_JSON = 'number,state,isDraft,reviewDecision,reviewRequests,mergeable,headRefOid,headRefName,baseRefName,statusCheckRollup,url,mergedAt,mergedBy,closedAt,title';
const FAIL_WORDS = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const PASS_WORDS = new Set(['SUCCESS', 'NEUTRAL']);
const SKIP_WORDS = new Set(['SKIPPED', 'STALE']);
const REPO_SLUG = /^[\w.-]+\/[\w.-]+$/;

function json(res, what) {
  if (!res?.ok) throw new Error(`${what}: ${res?.err ?? 'gh failed'}`);
  try { return JSON.parse(res.out); } catch { throw new Error(`${what}: unreadable output`); }
}

/** A check from gh's statusCheckRollup: { name, state: fail | pass | skipped | pending, link, runId }. */
export function rollupCheck(c) {
  const word = String(c?.conclusion || c?.state || c?.status || '').toUpperCase();
  const state = FAIL_WORDS.has(word) ? 'fail' : PASS_WORDS.has(word) ? 'pass' : SKIP_WORDS.has(word) ? 'skipped' : 'pending';
  const link = c?.detailsUrl ?? c?.targetUrl ?? null;
  return { name: String(c?.name ?? c?.context ?? 'a check'), state, link, runId: /\/actions\/runs\/(\d+)/.exec(String(link ?? ''))?.[1] ?? null };
}
const checksWord = (checks) => (!checks.length ? null : checks.some((c) => c.state === 'fail') ? 'failing' : checks.some((c) => c.state === 'pending') ? 'pending' : 'passing');

/**
 * One PR on GitHub, read only (gh pr view and gh api --method GET): its state, review decision,
 * requested reviewers, whether it merges cleanly, its newest commit and checks, its reviews,
 * line comments and conversation comments, and who closed it.
 */
export async function readPr(gh, repo, number) {
  if (!REPO_SLUG.test(String(repo)) || !Number.isInteger(number) || number < 1) throw new Error('Unexpected repository or PR number');
  const get = (p) => gh(['api', '--method', 'GET', p]);
  const v = json(await gh(['pr', 'view', String(number), '--repo', repo, '--json', PR_JSON]), 'gh pr view');
  const reviews = json(await get(`repos/${repo}/pulls/${number}/reviews?per_page=100`), 'gh api reviews');
  const lineComments = json(await get(`repos/${repo}/pulls/${number}/comments?per_page=100`), 'gh api comments');
  const issueComments = json(await get(`repos/${repo}/issues/${number}/comments?per_page=100`), 'gh api issue comments');
  const checks = (Array.isArray(v?.statusCheckRollup) ? v.statusCheckRollup : []).map(rollupCheck);
  const state = v?.state === 'OPEN' && v?.isDraft ? 'draft' : String(v?.state ?? '').toLowerCase();
  let closedBy = null;
  if (state === 'closed') {
    try {
      const events = json(await get(`repos/${repo}/issues/${number}/events?per_page=100`), 'gh api events');
      closedBy = (Array.isArray(events) ? events : []).filter((e) => e?.event === 'closed').at(-1)?.actor?.login ?? null;
    } catch { closedBy = null; }
  }
  const list = (x) => (Array.isArray(x) ? x : []);
  const approvals = list(reviews).filter((r) => r?.state === 'APPROVED');
  return {
    number, repo, url: v?.url ?? null, title: v?.title ?? '', state, draft: state === 'draft',
    review: v?.reviewDecision ? String(v.reviewDecision).toLowerCase() : null,
    reviewRequests: list(v?.reviewRequests).map((r) => r?.login ?? r?.name ?? null).filter(Boolean),
    mergeable: v?.mergeable ?? null, head: v?.headRefOid ?? null, headRef: v?.headRefName ?? null, base: v?.baseRefName ?? null,
    checks, checksWord: checksWord(checks), checkCount: checks.length,
    mergedAt: v?.mergedAt ?? null, mergedBy: v?.mergedBy?.login ?? null, closedAt: v?.closedAt ?? null, closedBy,
    closeReason: closedBy ? list(issueComments).filter((c) => c?.user?.login === closedBy).at(-1)?.body ?? null : null,
    approvedAt: approvals.at(-1)?.submitted_at ?? null, approvedHead: approvals.at(-1)?.commit_id ?? null,
    lastReviewer: list(reviews).at(-1)?.user?.login ?? null,
    reviews: list(reviews), lineComments: list(lineComments), issueComments: list(issueComments),
  };
}

// The PR as a view carries it: what the states need, not GitHub's comments themselves (those are in the round).
const PR_VIEW_FIELDS = ['number', 'repo', 'url', 'title', 'state', 'review', 'reviewRequests', 'mergeable', 'head', 'base', 'checkCount', 'mergedAt', 'mergedBy', 'closedAt', 'closedBy', 'closeReason', 'approvedAt', 'lastReviewer'];
function prForView(pr, extra) {
  const out = Object.fromEntries(PR_VIEW_FIELDS.map((k) => [k, pr[k] ?? null]));
  out.reviewRequests = pr.reviewRequests ?? [];
  out.closeReason = pr.closeReason ? cut(pr.closeReason, 200) : null;
  return { ...out, checks: pr.checksWord ?? null, ...extra };
}

/** The errors a page shows for the round's actions: HttpError-shaped ({ status, message }). */
export class ReviewRefused extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

/**
 * The coordinator. deps:
 *   gh(args)            read-only gh runner (lib/git.js ghRunner), or null: no GitHub is read
 *   write               lib/gh-write.js createGhWrite(): the only writer, every call with a yes
 *   driver              lib/driver.js: round cards, sendRoundMessage, activeRunFor
 *   jobs()              [{ dir, slug, title, branch, worktree, repoPath, closed, ticket }]
 *   profileFor(repo)    the repo's profile (prRoute, checks) or null
 *   audit(line)         an audit line; emit(slug, view): the 'pr' event; changed(): pages fetch again
 *   lockFor(dir)        the job's lock when another process holds it (lib/lock.js heldElsewhere), or null
 *   readStatus(dir)     the job's parsed status.json (lib/status-json.js) or null
 *   login()             your GitHub login(s)
 *   git(dir, args)      read-only git → { ok, out }
 *   settings() / saveSettings(patch)   { githubEveryMin, mergeFollowUp }
 *   refresh()           a network refresh of the flow map now (after a push or reply)
 *   now(), sleep(ms), checksEveryMs (polling a follow-up PR's checks), checksTimeoutMs
 */
export function createReviewRounds(deps) {
  const now = deps.now ?? (() => Date.now());
  const iso = () => new Date(now()).toISOString();
  const sleep = deps.sleep ?? ((t) => new Promise((r) => setTimeout(r, t)));
  const views = new Map(); // slug → the job's view
  const facts = new Map(); // slug → { f, lane, repo, route, twoStep, org, fork, prs: Map(number → readPr), current }
  const sent = new Map(); // slug → JSON of the last view sent
  const busy = new Set(); // slugs with a Send back running
  let passing = Promise.resolve();
  let me;

  const settings = async () => {
    const s = (await deps.settings?.()) ?? {};
    return { githubEveryMin: GITHUB_EVERY_CHOICES.includes(s.githubEveryMin) ? s.githubEveryMin : GITHUB_EVERY_DEFAULT, mergeFollowUp: s.mergeFollowUp !== false };
  };

  async function jobOf(slug) {
    const f = (await deps.jobs()).find((j) => j.slug === slug);
    if (!f) throw new ReviewRefused(404, 'No such job.');
    return f;
  }
  const fileOfRound = (f, r) => path.join(f.dir, ROUNDS_DIR, `round-${r.round}.md`);

  async function prMemory(f) {
    try { return JSON.parse(await fs.readFile(path.join(f.dir, 'review', 'prs.json'), 'utf8')) ?? {}; } catch { return {}; }
  }
  async function savePrMemory(f, mem) {
    await fs.mkdir(path.join(f.dir, 'review'), { recursive: true });
    const file = path.join(f.dir, 'review', 'prs.json');
    await fs.writeFile(`${file}.${process.pid}.tmp`, `${JSON.stringify(mem, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(`${file}.${process.pid}.tmp`, file);
  }

  // The round the job's view is about: the newest one not done, on the PR it is on.
  const currentRound = (rounds) => [...rounds].reverse().find((r) => r.state !== 'done') ?? null;

  async function aheadOf(f, fx) {
    const dir = f.worktree ?? null;
    const branch = fx.lane?.branch ?? f.branch;
    if (dir && branch && fx.fork) {
      const r = await deps.git?.(dir, ['rev-list', '--count', `${fx.fork}/${branch}..HEAD`]);
      if (r?.ok && /^\d+$/.test(r.out.trim())) return Number(r.out.trim());
      const all = await deps.git?.(dir, ['rev-list', '--count', 'HEAD', `^${fx.org ?? fx.fork}/${fx.base ?? 'main'}`]);
      if (all?.ok && /^\d+$/.test(all.out.trim())) return Number(all.out.trim());
    }
    return fx.lane?.unpushed ?? 0;
  }

  // The job's view from what is known now (no GitHub read), parked and sent when it changed.
  async function refreshJob(slug) {
    const fx = facts.get(slug);
    if (!fx) return null;
    const f = (await deps.jobs()).find((j) => j.slug === slug) ?? fx.f;
    fx.f = f;
    const rounds = await readRounds(f.dir);
    // The Foreman's report, from status.json prs[k].rounds.
    const status = await deps.readStatus?.(f.dir).catch(() => null);
    for (const r of rounds) {
      if (!['fixing', 'asked', 'check-failed'].includes(r.state)) continue;
      const report = status?.prs?.find((p) => p.number === r.pr)?.rounds?.find((x) => x.round === r.round) ?? null;
      if (report && applyForeman(r, report, { at: iso() })) {
        if (r.foreman?.state === 'ready' && foremanReady(r)) r.timeline.push({ at: iso(), words: 'The Foreman finished: ready to send back.' });
        await saveRound(f.dir, r, { route: fx.route });
      }
    }
    const round = currentRound(rounds);
    const prNumber = round?.prNumber ?? fx.current ?? null;
    const pr = prNumber ? fx.prs.get(prNumber) : null;
    if (!pr) { views.delete(slug); return null; }
    const mem = (await prMemory(f))[pr.number] ?? {};
    const runActive = Boolean(deps.driver?.activeRunFor?.({ featureDir: f.dir }));
    const ahead = await aheadOf(f, fx);
    const s = await settings();
    const followUp = round && fx.twoStep && round.pr === 2 ? openFollowUp(fx) : null;
    const ctx = { ahead, fork: fx.fork, branch: fx.lane?.branch ?? f.branch, orgRemote: fx.org, twoStep: fx.twoStep, followUp, mergeFollowUp: round?.send?.mergeFollowUp ?? s.mergeFollowUp };
    const lock = deps.lockFor?.(f.dir) ?? null;
    const view = reviewView({
      job: { slug: f.slug, title: f.title, ticket: f.ticket ?? null }, pr: prForView(pr, { routeNumber: routeOfPr(fx, pr.number), label: labelOf(fx, pr.number) }),
      round, route: fx.route, runActive, lock, now: now(), approvalReset: Boolean(mem.resetAt), remindedAt: mem.remindedAt ?? null, stagingNext: pr.base === 'staging' ? 'staging QA, then PR #3 with the release' : null,
      ...ctx,
    });
    if (!view?.state) { views.delete(slug); deps.driver?.dropRoundCard?.(f.dir, 'resolved'); return publish(slug, null); }
    view.rounds = rounds.map((r) => ({ round: r.round, pr: r.pr, prLabel: r.prLabel, state: r.state, items: r.items.filter((i) => i.added).length, openedAt: r.openedAt, sentAt: r.sentAt }));
    view.title = f.title ?? null;
    view.who = { reviewer: round ? nameFor(round.reviewer, fx.route) : null, mergesLine: whoMergesLine(fx.route) };
    views.set(slug, view);
    parkCard(f, view, round);
    return publish(slug, view);
  }

  function publish(slug, view) {
    const key = JSON.stringify(view);
    if (sent.get(slug) === key) return view;
    sent.set(slug, key);
    deps.emit?.(slug, view ?? { slug, state: null });
    deps.changed?.();
    return view;
  }

  // A Needs you card for the states that wait for your yes (and only a go / no go: merging and
  // asking someone to review need the panel).
  const CARD_STATES = new Set(['asked', 'ready', 'new-comment', 'stopped', 'check-failed', 'conflicts', 'closed', 'fix-stalled', 'held']);
  function parkCard(f, view, round) {
    const d = deps.driver;
    if (!d?.parkRoundCard) return;
    if (!CARD_STATES.has(view.state) || !view.desk) { d.dropRoundCard(f.dir, 'resolved'); return; }
    const acts = view.desk.actions.filter((a) => !a.client && a.go !== null);
    const key = `${view.state}:${round?.round ?? 0}:${view.heldState ?? ''}`;
    // Not yet: the card goes until the round moves on (the panel still offers the go).
    if (!acts.length || (round?.snoozed && round.snoozed === key)) { d.dropRoundCard(f.dir, 'resolved'); return; }
    const go = acts.find((a) => a.go === true);
    const noGo = acts.find((a) => a.go === false);
    d.parkRoundCard({ featureDir: f.dir, slug: f.slug, title: f.title }, {
      key, header: view.pr.label, headline: view.bar.headline, detail: view.bar.detail ?? null, sentence: view.desk.sentence ?? null,
      actions: [go, noGo].filter(Boolean).map((a) => ({ id: a.id, label: a.label, description: a.playLabel })),
      disabled: go && !go.enabled ? go.reason : null,
      review: { slug: f.slug, state: view.state, round: round?.round ?? null, pr: view.pr.number, prLabel: view.pr.label },
    });
  }

  const labelOf = (fx, number) => (fx.twoStep ? (fx.lane?.pr1?.number === number ? 'PR #1' : 'PR #2') : `PR #${number}`);
  const routeOfPr = (fx, number) => (fx.twoStep ? (fx.lane?.pr1?.number === number ? 1 : 2) : 1);
  const openFollowUp = (fx) => (fx.lane?.pr1 && ['open', 'draft'].includes(fx.lane.pr1.state) ? { number: fx.lane.pr1.number, url: fx.lane.pr1.url ?? null } : null);

  // One PR, read and grouped into rounds.
  async function lookPr(f, fx, number, repo, mine) {
    const pr = await readPr(deps.gh, repo, number);
    fx.prs.set(number, pr);
    const label = labelOf(fx, number);
    const rounds = await readRounds(f.dir);
    const record = await readFeedbackRecord(f.dir);
    const firstLook = !lookedAtPr(record, number) && !rounds.some((r) => r.prNumber === number);
    const candidates = candidatesOf({ reviews: pr.reviews, lineComments: pr.lineComments, issueComments: pr.issueComments, prNumber: number, me: mine });
    const g = groupRounds({ rounds, candidates, checks: pr.checks, head: pr.head, feedback: record.items, firstLook, pr: { number, route: routeOfPr(fx, number), label, url: pr.url }, at: iso(), decision: pr.review });
    for (const key of g.claimed) await noteRound(f.dir, key);
    for (const key of g.takeFromN) { const c = deps.driver?.feedbackCardFor?.(f.dir, key); if (c) deps.driver.dropFeedbackCard(c.id, 'round'); }
    // A sent round is answered: a new round from the same reviewer, or an approval, closes it.
    for (const r of g.rounds) {
      if (r.prNumber !== number) continue;
      const newer = g.rounds.some((x) => x.prNumber === number && x.reviewer === r.reviewer && x.round > r.round);
      if (r.state === 'sent' && (newer || pr.review === 'approved' || ['merged', 'closed'].includes(pr.state))) {
        r.state = 'done';
        r.timeline.push({ at: iso(), words: newer ? `${nameFor(r.reviewer, fx.route)} answered with a new round.` : pr.review === 'approved' ? `${nameFor(r.reviewer, fx.route)} approved.` : `${label} was ${pr.state}.` });
        g.changed.push(r.round);
      }
      if (r.state === 'after-pr1' && fx.lane?.pr1?.state === 'merged' && fx.lane.pr1.number === r.followUp?.number) await deps.onFollowUpMerged?.(f, r);
    }
    const changed = new Set(g.changed);
    for (const r of g.rounds) {
      if (!changed.has(r.round)) continue;
      // The logs of the checks that joined (gh run view, read only).
      for (const i of r.items) {
        if (i.type !== 'check' || i.log || !i.runId || !deps.failedLog) continue;
        try { i.log = cut(await deps.failedLog(repo, i.runId), QUOTE_MAX); } catch { i.log = null; }
      }
      const isNew = !rounds.some((x) => x.round === r.round);
      await saveRound(f.dir, r, { route: fx.route });
      if (isNew) await deps.audit?.({ action: 'review-round-opened', featureDir: f.dir, slug: f.slug, round: r.round, pr: r.pr, prNumber: number, prLabel: label, reviewer: r.reviewer, items: r.items.length, reviewState: r.reviewState });
      else await deps.audit?.({ action: 'review-round-joined', featureDir: f.dir, slug: f.slug, round: r.round, pr: r.pr, prLabel: label, items: r.items.length, late: r.items.filter((i) => i.late && !i.added).length, state: r.state });
    }
    // The approval, remembered: a push that drops it is said in words (approval-reset).
    const mem = await prMemory(f);
    const was = mem[number] ?? {};
    const next = { ...was, decision: pr.review, head: pr.head };
    if (pr.review === 'approved') Object.assign(next, { approvedAt: pr.approvedAt ?? was.approvedAt ?? iso(), approvedHead: pr.approvedHead ?? pr.head, resetAt: null });
    else if (was.decision === 'approved' && pr.review === 'review_required' && was.approvedHead && pr.head !== was.approvedHead) next.resetAt = iso();
    else if (pr.review !== 'review_required') next.resetAt = null;
    if (JSON.stringify(next) !== JSON.stringify(was)) { mem[number] = next; await savePrMemory(f, mem); }
  }

  /**
   * After each network refresh of the flow map (flow: its view): every open job's PRs, read and
   * grouped. Runs before N's look at the same PRs (the runner chains it first), so a round's items
   * are marked before N would card them. One pass at a time.
   */
  function pass(view) {
    passing = passing.then(() => passNow(view)).catch((err) => deps.problem?.(err));
    return passing;
  }
  async function passNow(view) {
    if (!deps.gh) return;
    const jobs = await deps.jobs();
    if (me === undefined) me = (await deps.login?.().catch(() => null)) ?? null;
    const seen = new Set();
    for (const r of view?.repos ?? []) {
      const repo = r.org?.slug ?? r.fork?.slug ?? null;
      if (!r.prsKnown || !repo) continue;
      const twoStep = Boolean(r.org && r.fork);
      const profile = await deps.profileFor?.(r.repo).catch(() => null);
      const route = parseRoute(profile?.prRoute, { twoStep });
      const mine = [r.fork?.slug?.split('/')[0], ...(Array.isArray(me) ? me : [me])].filter(Boolean);
      for (const lane of r.lanes ?? []) {
        const f = jobs.find((j) => j.slug === lane.slug);
        if (!f || f.closed) continue;
        const fx = facts.get(f.slug) ?? { prs: new Map() };
        Object.assign(fx, { f, lane, repo, route, twoStep, org: r.org?.remote ?? null, fork: r.fork?.remote ?? null, forkOwner: r.fork?.slug?.split('/')[0] ?? null, base: r.main?.ref?.split('/').slice(1).join('/') ?? 'main', checks: Array.isArray(profile?.checks) ? profile.checks : [] });
        facts.set(f.slug, fx);
        const rounds = await readRounds(f.dir);
        // Open, or with a round still going, or closed while the job was on it (it waits for Reopen).
        const live = (p) => p && (['open', 'draft'].includes(p.state) || rounds.some((x) => x.prNumber === p.number && x.state !== 'done') || (p.state === 'closed' && fx.current === p.number));
        const prs = [lane.pr1, lane.pr2].filter(live);
        for (const p of prs) {
          try { await lookPr(f, fx, p.number, repo, mine); } catch (err) { deps.problem?.(new Error(`review rounds (${f.slug}, PR ${p.number}): ${err.message}`)); }
        }
        // The PR the job is on: the newest round's, else PR #2 when open, else PR #1.
        const after = await readRounds(f.dir);
        const cur = currentRound(after);
        fx.current = cur?.prNumber ?? prs.map((p) => p.number).at(-1) ?? null;
        seen.add(f.slug);
        await refreshJob(f.slug);
      }
    }
    for (const slug of [...facts.keys()]) {
      if (seen.has(slug)) continue;
      const fx = facts.get(slug);
      if (jobs.find((j) => j.slug === slug && !j.closed)) continue;
      facts.delete(slug);
      views.delete(slug);
      if (fx?.f?.dir) deps.driver?.dropRoundCard?.(fx.f.dir, 'closed');
      publish(slug, null);
    }
  }

  // ---------- Your answers ----------

  async function load(slug) {
    const f = await jobOf(slug);
    const fx = facts.get(slug);
    if (!fx) throw new ReviewRefused(404, 'This job has no review round yet.');
    const rounds = await readRounds(f.dir);
    return { f, fx, rounds, round: currentRound(rounds) };
  }
  function needRound(round, states, words) {
    if (!round) throw new ReviewRefused(409, 'This job has no review round open.');
    if (!states.includes(round.state)) throw new ReviewRefused(409, words ?? `Round ${round.round} can’t do that now.`);
  }
  function needLock(f) {
    const lock = deps.lockFor?.(f.dir);
    if (lock) throw new ReviewRefused(409, `${lockWords(lock)} Send back is off until the terminal lets go.`, { code: 'job-locked' });
  }
  const lockWords = (lock) => `This job is being driven from a terminal (pid ${lock.pid ?? 'unknown'}${lock.branch ? `, branch ${lock.branch}` : ''}).`;

  async function tellForeman(f, fx, round, what) {
    const text = foremanMessage(round, { route: fx.route, checks: fx.checks ?? [], what, base: fx.prs.get(round.prNumber)?.base ?? 'staging', roundFile: fileOfRound(f, round) });
    return deps.driver.sendRoundMessage({ featureDir: f.dir, slug: f.slug, title: f.title, text, key: `round-${round.round}` });
  }

  const actions = {
    /** Fix with the Foreman: the round, the included items and your note, to the job's session. */
    async fix(slug, { note } = {}) {
      const { f, fx, round } = await load(slug);
      const stalled = round?.state === 'fixing' && !deps.driver?.activeRunFor?.({ featureDir: f.dir });
      if (!stalled) needRound(round, ['asked', 'left'], `Round ${round?.round} is with the Foreman already.`);
      needLock(f);
      if (typeof note === 'string') round.note = note.trim().slice(0, 2000) || null;
      if (!round.items.some((i) => i.included)) throw new ReviewRefused(400, 'Every item is left out: tick at least one, or leave the round for now.');
      const was = round.state;
      round.state = 'fixing';
      const res = await tellForeman(f, fx, round, stalled ? 'more' : 'fix').catch((err) => { round.state = was; throw err; });
      round.timeline.push({ at: iso(), words: stalled ? 'You asked the Foreman to carry on.' : `You said go: the Foreman works on ${plural(round.items.filter((i) => i.included).length, 'item')}${res.outcome === 'queued' ? ' once its reply in progress ends' : ''}.` });
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-fix', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, items: round.items.filter((i) => i.included).length, left: round.items.filter((i) => !i.included).length, outcome: res.outcome, runId: res.runId ?? undefined, again: stalled || undefined });
      return refreshJob(slug);
    },
    /** Leave it for now: nothing is sent; the round waits on the panel. */
    async leave(slug, { note } = {}) {
      const { f, fx, round } = await load(slug);
      needRound(round, ['asked', 'check-failed', 'left']);
      round.state = 'left';
      round.leftAt = iso();
      round.timeline.push({ at: iso(), words: 'You left the round for now.' });
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-left', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, note: note || undefined });
      return refreshJob(slug);
    },
    /** One item: include or leave it out, its kind, its reply (edited or dropped), the reason it won't change. */
    async item(slug, body = {}) {
      const { f, fx, round } = await load(slug);
      needRound(round, ['asked', 'left', 'fixing', 'check-failed', 'stopped'], 'The round is being sent back: items can’t change now.');
      const item = round.items.find((i) => i.id === body.id);
      if (!item) throw new ReviewRefused(404, 'No such item in this round.');
      if (typeof body.included === 'boolean') {
        if (round.state !== 'asked' && round.state !== 'left' && body.included === false && item.state !== 'todo') throw new ReviewRefused(409, 'The Foreman has worked on this one already.');
        item.included = body.included;
      }
      if (body.kind !== undefined) {
        if (!KINDS.includes(body.kind) || body.kind === 'check' || item.type === 'check') throw new ReviewRefused(400, 'A kind is change, question or nit.');
        item.kind = body.kind; item.kindBy = 'you';
      }
      if (typeof body.reply === 'string') { if (noReply(item)) throw new ReviewRefused(400, 'A check gets no reply.'); item.reply = cut(body.reply, QUOTE_MAX) || null; item.replyEdited = true; }
      if (typeof body.replyDropped === 'boolean') item.replyDropped = body.replyDropped;
      if (typeof body.reason === 'string') item.reason = cut(body.reason, 1000) || null;
      await saveRound(f.dir, round, { route: fx.route });
      return refreshJob(slug);
    },
    /** A note for the Foreman, sent with the go. */
    async note(slug, { note } = {}) {
      const { f, fx, round } = await load(slug);
      needRound(round, ['asked', 'left', 'check-failed']);
      round.note = String(note ?? '').trim().slice(0, 2000) || null;
      await saveRound(f.dir, round, { route: fx.route });
      return refreshJob(slug);
    },
    /** New comments that joined while the Foreman works: onto its list. */
    async 'add-new'(slug) {
      const { f, fx, round } = await load(slug);
      needRound(round, ['fixing']);
      const late = round.items.filter((i) => i.late && !i.added);
      if (!late.length) throw new ReviewRefused(409, 'No new comments are waiting.');
      needLock(f);
      for (const i of late) i.added = true;
      const res = await tellForeman(f, fx, { ...round, items: late }, 'more').catch((err) => { for (const i of late) i.added = false; throw err; });
      round.timeline.push({ at: iso(), words: `You added ${plural(late.length, 'new comment')} to the Foreman’s list.` });
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-fix', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, items: late.length, outcome: res.outcome, added: true });
      return refreshJob(slug);
    },
    /** New comments left out of the round (they still show, marked Left out). */
    async 'leave-new'(slug) {
      const { f, fx, round } = await load(slug);
      needRound(round, ['fixing']);
      for (const i of round.items.filter((x) => x.late && !x.added)) { i.added = true; i.included = false; }
      round.timeline.push({ at: iso(), words: 'You left the new comments out of the round.' });
      await saveRound(f.dir, round, { route: fx.route });
      return refreshJob(slug);
    },
    /** An item kept as it is, changed after all: back to the Foreman. */
    async 'change-after-all'(slug, { id } = {}) {
      const { f, fx, round } = await load(slug);
      needRound(round, ['fixing', 'stopped']);
      const item = round.items.find((i) => i.id === id);
      if (!item || item.state !== 'wont_change') throw new ReviewRefused(409, 'Only an item kept as it is can be changed after all.');
      needLock(f);
      Object.assign(item, { state: 'todo', plan: 'fix', reason: null, reply: item.replyEdited ? item.reply : null });
      if (round.foreman) round.foreman.state = 'fixing';
      if (round.state === 'stopped') round.state = 'fixing';
      const res = await tellForeman(f, fx, { ...round, items: [item], note: `Change it after all: the person wants ${item.id} fixed, not kept as it is.` }, 'more');
      round.timeline.push({ at: iso(), words: `You asked for ${item.file ?? 'an item'} to be changed after all.` });
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-fix', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, items: 1, outcome: res.outcome, afterAll: item.id });
      return refreshJob(slug);
    },
  };

  // ---------- Send back (lib/gh-write.js, one call per line, each in the audit) ----------

  const sending = new Map(); // slug → the round being sent (Stop after this step changes it in place)
  const stepRecord = (s) => { const { run, ...rest } = s; void run; return rest; };

  async function shaOf(f) {
    if (!f.worktree) return null;
    const r = await deps.git?.(f.worktree, ['rev-parse', 'HEAD']);
    return r?.ok ? r.out.trim() : null;
  }

  async function commitsFor(f, fx, branch) {
    if (!f.worktree || !fx.org) return [];
    const r = await deps.git?.(f.worktree, ['log', '--format=%H%x09%s', `${fx.org}/${branch}..HEAD`]);
    return r?.ok ? r.out.split('\n').filter(Boolean).map((l) => { const [sha, ...rest] = l.split('\t'); return { sha, subject: rest.join('\t') }; }) : [];
  }

  // Wait for a PR's checks to pass (read only), up to checksTimeoutMs.
  async function waitForChecks(repo, number, step, round, f) {
    const every = deps.checksEveryMs ?? 20000;
    const until = now() + (deps.checksTimeoutMs ?? 30 * 60 * 1000);
    for (;;) {
      const pr = await readPr(deps.gh, repo, number);
      if (pr.state === 'merged') return { ok: true, merged: true };
      if (pr.state === 'closed') return { ok: false, err: `the follow-up PR #1 (#${number}) was closed`, failWords: 'the follow-up PR #1 was closed' };
      if (pr.checksWord === 'failing') return { ok: false, err: `its checks failed: ${listWords(pr.checks.filter((c) => c.state === 'fail').map((c) => c.name))}`, failWords: 'the follow-up PR #1’s checks failed' };
      if (pr.checksWord !== 'pending') return { ok: true };
      if (now() >= until) return { ok: false, err: 'its checks took longer than half an hour', failWords: 'the follow-up PR #1’s checks didn’t finish' };
      step.waiting = 'Waiting for the follow-up PR #1’s checks before merging it.';
      await saveRound(f.dir, round, { route: facts.get(f.slug)?.route ?? [] });
      await refreshJob(f.slug);
      await sleep(every);
    }
  }

  function stepRunners(f, fx, round, y) {
    const repo = fx.repo;
    const number = round.prNumber;
    const branch = fx.lane?.branch ?? f.branch;
    const ctx = { yes: y, featureDir: f.dir, slug: f.slug };
    const items = () => round.items.filter((i) => i.included && i.added);
    return {
      push: async () => {
        const res = await deps.write.push({ ...ctx, dir: f.worktree, remote: fx.fork, branch });
        if (res.ok) { round.sentHead = await shaOf(f); deps.refresh?.(); }
        return res.ok ? res : { ...res, failWords: 'the push didn’t go through' };
      },
      'follow-up': async (step) => {
        if (!round.followUp?.number) {
          const open = openFollowUp(fx);
          if (open) round.followUp = { number: open.number, url: open.url, opened: false };
          else {
            const pr2 = fx.prs.get(number);
            const res = await deps.write.openPr({ ...ctx, repo, base: branch, head: `${fx.forkOwner}:${branch}`, title: followUpTitle(round, fx.route), body: followUpBody(round, { route: fx.route, commits: await commitsFor(f, fx, branch), prUrl: pr2?.url ?? round.prUrl }) });
            if (!res.ok) return { ...res, failWords: 'the follow-up PR #1 didn’t open' };
            round.followUp = { number: res.number, url: res.url, opened: true };
          }
          round.timeline.push({ at: iso(), words: `The follow-up PR #1 (#${round.followUp.number}) is open.` });
          await saveRound(f.dir, round, { route: fx.route });
        }
        if (round.send?.mergeFollowUp === false) return { ok: true, waiting: true };
        const checks = await waitForChecks(repo, round.followUp.number, step, round, f);
        step.waiting = null;
        if (!checks.ok) return checks;
        if (checks.merged) return { ok: true };
        const res = await deps.write.mergePr({ ...ctx, repo, number: round.followUp.number, method: routeStep(fx.route, 1).squash ? 'squash' : 'merge' });
        if (res.ok) round.timeline.push({ at: iso(), words: `The follow-up PR #1 (#${round.followUp.number}) is merged: ${round.prLabel} has the fixes.` });
        return res.ok ? res : { ...res, failWords: 'the follow-up PR #1 didn’t merge' };
      },
      replies: async () => {
        const list = items().filter((i) => !noReply(i) && i.reply && !i.replyDropped);
        let k = 0;
        for (const i of list) {
          k++;
          if (i.posted?.ok) continue; // never posted twice
          const res = await deps.write.reply({ ...ctx, repo, number, comment: { type: i.type, id: i.githubId, author: i.author, quote: i.quote }, body: i.reply });
          i.posted = { ok: res.ok, at: iso(), id: res.posted ?? null, err: res.err ?? null };
          await saveRound(f.dir, round, { route: fx.route });
          if (!res.ok) { deps.refresh?.(); return { ...res, failWords: `reply ${k} of ${list.length} didn’t post` }; }
        }
        deps.refresh?.();
        return { ok: true };
      },
      resolve: async () => {
        const list = items().filter((i) => i.type === 'line' && i.state === 'fixed');
        let k = 0;
        for (const i of list) {
          k++;
          if (i.resolved) continue;
          const res = await deps.write.resolveThread({ ...ctx, repo, number, commentId: i.githubId });
          if (!res.ok) return { ...res, failWords: `marking comment ${k} of ${list.length} resolved didn’t work` };
          i.resolved = true;
          await saveRound(f.dir, round, { route: fx.route });
        }
        return { ok: true };
      },
      request: async () => {
        const res = await deps.write.requestReview({ ...ctx, repo, number, login: round.reviewer });
        if (res.ok) round.requestedAt = iso();
        return res.ok ? res : { ...res, failWords: `asking ${nameFor(round.reviewer, fx.route)} again didn’t work` };
      },
    };
  }

  // Runs the round's steps that aren't done, in order; the first failure stops the rest.
  async function runSend(f, fx, round, y) {
    const slug = f.slug;
    busy.add(slug);
    sending.set(slug, round);
    try {
      const runners = stepRunners(f, fx, round, y);
      const steps = round.send.steps.map((s) => ({ ...s, run: () => runners[s.id](s) }));
      const res = await runSteps(steps, {
        stopAfter: () => Boolean(round.send.stopAfter),
        onStep: async (s) => {
          round.send.steps = steps.map(stepRecord);
          if (s.state === 'done' || s.state === 'stopped') {
            await deps.audit?.({ action: 'review-round-step', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, step: s.id, number: s.number, words: s.words, ok: s.state === 'done', error: s.error ?? undefined, code: s.code ?? undefined });
            round.timeline.push({ at: iso(), words: s.state === 'done' ? `Step ${s.number}: ${s.words}. Done.` : `Step ${s.number} stopped: ${s.error}.` });
          }
          await saveRound(f.dir, round, { route: fx.route });
          await refreshJob(slug);
        },
      });
      round.send.steps = steps.map(stepRecord);
      round.send.endedAt = iso();
      if (res.ok) {
        Object.assign(round, { state: 'sent', sentAt: iso(), snoozed: null });
        round.sentHead ??= fx.prs.get(round.prNumber)?.head ?? null;
        round.timeline.push({ at: iso(), words: `Round ${round.round} went back to ${nameFor(round.reviewer, fx.route)}.` });
        await deps.audit?.({ action: 'review-round-sent', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, reviewer: nameFor(round.reviewer, fx.route) });
      } else if (res.waiting) {
        round.state = 'after-pr1';
      } else {
        round.state = 'stopped';
        round.snoozed = null;
        await deps.audit?.({ action: 'review-round-stopped', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, at: res.stoppedAt + 1, byYou: res.stoppedByYou || undefined });
      }
      await saveRound(f.dir, round, { route: fx.route });
    } catch (err) {
      round.state = 'stopped';
      await saveRound(f.dir, round, { route: fx.route }).catch(() => {});
      deps.problem?.(err);
    } finally {
      busy.delete(slug);
      sending.delete(slug);
      deps.refresh?.();
      await refreshJob(slug).catch(() => {});
    }
  }

  // Starts Send back (or carries it on) and returns at once: the view shows each step as it goes.
  function startSend(f, fx, round, y) {
    const done = runSend(f, fx, round, y);
    inFlight.set(f.slug, done);
    done.finally(() => { if (inFlight.get(f.slug) === done) inFlight.delete(f.slug); });
  }
  const inFlight = new Map();

  Object.assign(actions, {
    /** Send back: every step listed first, one go runs them in order. */
    async send(slug, { go, mergeFollowUp } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'Send back runs only on your go.');
      const { f, fx, round } = await load(slug);
      needRound(round, ['fixing'], `Round ${round?.round} isn’t ready to send back.`);
      if (!foremanReady(round) || deps.driver?.activeRunFor?.({ featureDir: f.dir })) throw new ReviewRefused(409, 'The Foreman is still on it: Send back waits until the round is ready.');
      if (busy.has(slug)) throw new ReviewRefused(409, 'This round is being sent back already.');
      if (!deps.write) throw new ReviewRefused(409, 'Nothing can be written to GitHub from here.');
      needLock(f);
      if (round.items.some((i) => i.late && !i.added)) throw new ReviewRefused(409, 'New comments joined the round: add them to the Foreman’s list or leave them out first.');
      const s = await settings();
      const merge = typeof mergeFollowUp === 'boolean' ? mergeFollowUp : s.mergeFollowUp;
      const plan = sendPlan(round, { ahead: await aheadOf(f, fx), fork: fx.fork, branch: fx.lane?.branch ?? f.branch, orgRemote: fx.org, twoStep: fx.twoStep, followUp: openFollowUp(fx), mergeFollowUp: merge }, { route: fx.route });
      if (!plan.length) throw new ReviewRefused(409, 'There is nothing to send back.');
      const what = `Send back round ${round.round} on ${round.prLabel}`;
      round.send = { startedAt: iso(), steps: plan.map((p) => ({ ...p, state: 'will' })), stopAfter: false, mergeFollowUp: merge, yes: what };
      round.state = 'sending';
      round.timeline.push({ at: iso(), words: `You said go: ${what.charAt(0).toLowerCase()}${what.slice(1)}, ${plural(plan.length, 'step')}.` });
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-send', what: 'go', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, steps: plan.length, mergeFollowUp: merge });
      startSend(f, fx, round, yesFor({ what }));
      return refreshJob(slug);
    },
    /** Not yet: nothing runs; the card goes until the round moves on. */
    async 'not-yet'(slug) {
      const { f, fx, round } = await load(slug);
      needRound(round, ['fixing', 'stopped']);
      const v = views.get(slug);
      round.snoozed = `${v?.state ?? round.state}:${round.round}:${v?.heldState ?? ''}`;
      round.timeline.push({ at: iso(), words: 'You said not yet.' });
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-send', what: 'not-yet', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel });
      return refreshJob(slug);
    },
    /** Stop after this step: the step in progress finishes, the rest don't run. */
    async 'stop-after-step'(slug) {
      const round = sending.get(slug);
      if (!round) throw new ReviewRefused(409, 'Nothing is being sent back now.');
      round.send.stopAfter = true;
      const f = await jobOf(slug);
      await saveRound(f.dir, round, { route: facts.get(slug)?.route ?? [] });
      await deps.audit?.({ action: 'review-round-send', what: 'stop-after', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel });
      return refreshJob(slug);
    },
    /** Try again from here: the failed step and the ones after it; what is done doesn't run again. */
    async retry(slug, { go } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'Try again runs only on your go.');
      const { f, fx, round } = await load(slug);
      needRound(round, ['stopped']);
      if (busy.has(slug)) throw new ReviewRefused(409, 'This round is being sent back already.');
      needLock(f);
      for (const s of round.send.steps) if (s.state !== 'done' && s.state !== 'skipped') Object.assign(s, { state: 'will', error: null, code: null, failWords: null });
      round.send.stopAfter = false;
      round.state = 'sending';
      const what = `${round.send.yes ?? `Send back round ${round.round}`}: try again from step ${round.send.steps.find((s) => s.state === 'will')?.number ?? '?'}`;
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-send', what: 'retry', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel });
      startSend(f, fx, round, yesFor({ what }));
      return refreshJob(slug);
    },
    /** You said you'd merge the follow-up PR #1 yourself; merge it from here after all. */
    async 'merge-follow-up'(slug, { go } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'Merging runs only on your go.');
      const { f, fx, round } = await load(slug);
      needRound(round, ['after-pr1']);
      needLock(f);
      round.send.mergeFollowUp = true;
      for (const s of round.send.steps) if (s.id === 'follow-up' || s.state === 'after-pr1') s.state = 'will';
      round.state = 'sending';
      await saveRound(f.dir, round, { route: fx.route });
      startSend(f, fx, round, yesFor({ what: `Merge the follow-up PR #1 for round ${round.round}, then the rest of Send back` }));
      return refreshJob(slug);
    },
  });

  // The follow-up PR #1 you merged yourself is merged: steps 3 to 5 run now, on the go you gave.
  deps.onFollowUpMerged ??= async (f, round) => {
    if (busy.has(f.slug) || round.state !== 'after-pr1') return;
    const fx = facts.get(f.slug);
    for (const s of round.send.steps) if (s.state === 'after-pr1') s.state = 'will';
    round.state = 'sending';
    round.timeline.push({ at: iso(), words: `You merged the follow-up PR #1 (#${round.followUp?.number}): the rest of Send back runs now.` });
    await saveRound(f.dir, round, { route: fx.route });
    startSend(f, fx, round, yesFor({ what: `${round.send.yes ?? `Send back round ${round.round}`} (after you merged PR #1)` }));
  };

  // ---------- The unhappy paths (step 5) ----------

  // The PR the job is on, as last read.
  function currentPr(fx) {
    const pr = fx.current ? fx.prs.get(fx.current) : null;
    if (!pr) throw new ReviewRefused(409, 'This job’s pull request hasn’t been read yet. Check GitHub now and try again.');
    return pr;
  }
  const needState = (slug, states, words) => {
    const v = views.get(slug);
    const st = v?.heldState ?? v?.state ?? null;
    if (!states.includes(st)) throw new ReviewRefused(409, words);
    return v;
  };

  Object.assign(actions, {
    /** A check failed on the push: the log to the Foreman, the same loop. */
    async 'fix-checks'(slug, { go } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'This runs only on your go.');
      const { f, fx, round } = await load(slug);
      needRound(round, ['check-failed'], 'No check has failed on the push.');
      needLock(f);
      for (const i of round.items) if (i.type === 'check' && i.state !== 'fixed') { i.added = true; i.late = false; i.included = true; }
      round.state = 'fixing';
      if (round.foreman) round.foreman.state = 'fixing';
      const res = await tellForeman(f, fx, round, 'checks').catch((err) => { round.state = 'check-failed'; throw err; });
      round.timeline.push({ at: iso(), words: 'You sent the failed check to the Foreman.' });
      await saveRound(f.dir, round, { route: fx.route });
      await deps.audit?.({ action: 'review-round-fix', featureDir: f.dir, slug, round: round.round, pr: round.pr, prLabel: round.prLabel, items: round.items.filter((i) => i.type === 'check' && i.state !== 'fixed').length, outcome: res.outcome, checks: true });
      return refreshJob(slug);
    },
    /** The base moved and conflicts: a round of its own, bringing it in with the Foreman (merge, never rebase), then the same Send back. */
    async sync(slug, { go } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'This runs only on your go.');
      const { f, fx, rounds } = await load(slug);
      needState(slug, ['conflicts'], 'This pull request doesn’t conflict with its base.');
      needLock(f);
      const pr = currentPr(fx);
      const base = pr.base ?? 'staging';
      const last = [...rounds].reverse().find((r) => r.prNumber === pr.number) ?? null;
      const r = newRound({ number: Math.max(0, ...rounds.map((x) => x.round)) + 1, prNumber: pr.number, route: routeOfPr(fx, pr.number), prLabel: labelOf(fx, pr.number), prUrl: pr.url, author: last?.reviewer ?? null, first: { at: iso(), commit: pr.head }, head: pr.head, at: iso() });
      Object.assign(r, { sync: true, state: 'fixing', reviewState: null });
      r.items.push({ ...itemOf({ type: 'sync', id: `sync:${base}`, githubId: null, author: null, body: `Bring ${base} into this branch: merge it in (never rebase), resolve the conflicts, run the checks, commit the merge.`, at: iso() }), id: `sync:${base}`, type: 'sync', kind: 'change' });
      r.timeline = [{ at: iso(), words: `${labelOf(fx, pr.number)} conflicts with ${base}: you asked the Foreman to bring it in.` }];
      const res = await tellForeman(f, fx, r, 'sync');
      await saveRound(f.dir, r, { route: fx.route });
      await deps.audit?.({ action: 'review-round-opened', featureDir: f.dir, slug, round: r.round, pr: r.pr, prNumber: pr.number, prLabel: r.prLabel, reviewer: null, items: 1, sync: base, outcome: res.outcome });
      return refreshJob(slug);
    },
    /** No one has been asked: ask someone (the route's reviewer filled in). */
    async 'ask-review'(slug, { go, login } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'This runs only on your go.');
      const { f, fx } = await load(slug);
      needState(slug, ['no-reviewer', 'approval-reset', 'waiting'], 'Someone has been asked already.');
      needLock(f);
      if (!deps.write) throw new ReviewRefused(409, 'Nothing can be written to GitHub from here.');
      const pr = currentPr(fx);
      const who = String(login ?? '').trim().replace(/^@/, '');
      if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(who)) throw new ReviewRefused(400, 'Type their GitHub name, like raj-moxie.');
      const res = await deps.write.requestReview({ yes: yesFor({ what: `Ask ${who} to review ${labelOf(fx, pr.number)}` }), featureDir: f.dir, slug, repo: fx.repo, number: pr.number, login: who });
      if (!res.ok) throw new ReviewRefused(502, `GitHub didn’t take it: ${res.err}`);
      await deps.audit?.({ action: 'review-ask', featureDir: f.dir, slug, login: who, prLabel: labelOf(fx, pr.number) });
      pr.reviewRequests = [...new Set([...(pr.reviewRequests ?? []), who])];
      deps.refresh?.();
      return refreshJob(slug);
    },
    /** A PR closed without merging: reopen it. */
    async reopen(slug, { go } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'This runs only on your go.');
      const { f, fx } = await load(slug);
      needState(slug, ['closed'], 'This pull request isn’t closed.');
      needLock(f);
      if (!deps.write) throw new ReviewRefused(409, 'Nothing can be written to GitHub from here.');
      const pr = currentPr(fx);
      const res = await deps.write.reopenPr({ yes: yesFor({ what: `Reopen ${labelOf(fx, pr.number)}` }), featureDir: f.dir, slug, repo: fx.repo, number: pr.number });
      if (!res.ok) throw new ReviewRefused(502, `GitHub didn’t take it: ${res.err}`);
      await deps.audit?.({ action: 'review-reopen', featureDir: f.dir, slug, prLabel: labelOf(fx, pr.number) });
      pr.state = 'open';
      deps.refresh?.();
      return refreshJob(slug);
    },
  });

  // ---------- Approved, then merged (step 6) ----------

  Object.assign(actions, {
    /**
     * Merge: a hard line, always asked. Only when the route lets you merge this PR, it is approved
     * (or yours to review) and green, and the ask's go came with confirm "merge PR #<n>".
     */
    async merge(slug, { go, confirm } = {}) {
      const { f, fx } = await load(slug);
      const v = needState(slug, ['approved-you-merge'], 'This pull request isn’t yours to merge now.');
      const label = v.pr.label;
      if (go !== true || String(confirm ?? '').trim().toLowerCase() !== `merge ${label}`.toLowerCase()) throw new ReviewRefused(400, `Merging is a hard line: it needs the go from the ask (“Merge ${label} into ${v.pr.base ?? 'its base'}?”).`, { code: 'merge-needs-confirm' });
      needLock(f);
      if (!deps.write) throw new ReviewRefused(409, 'Nothing can be written to GitHub from here.');
      const pr = currentPr(fx);
      const res = await deps.write.mergePr({ yes: yesFor({ what: `Merge ${label} into ${pr.base ?? 'its base'}` }), featureDir: f.dir, slug, repo: fx.repo, number: pr.number, method: v.merge?.method ?? 'merge' });
      await deps.audit?.({ action: 'review-merge', featureDir: f.dir, slug, prLabel: label, number: pr.number, ok: res.ok, error: res.err ?? undefined });
      if (!res.ok) throw new ReviewRefused(502, `GitHub didn’t merge it: ${res.err}`);
      pr.state = 'merged';
      pr.mergedAt = iso();
      pr.mergedBy = Array.isArray(me) ? me[0] ?? null : me ?? null;
      deps.refresh?.();
      return refreshJob(slug);
    },
    /** Remind the person who merges: a comment from you, drafted, shown before it is sent. */
    async remind(slug, { go, text } = {}) {
      if (go !== true) throw new ReviewRefused(400, 'The reminder goes only on your go.');
      const { f, fx } = await load(slug);
      const v = needState(slug, ['approved-they-merge'], 'There is no one to remind now.');
      if (!v.remind?.can) throw new ReviewRefused(409, `Remind is there from ${clock(v.remind?.at, iso())}, a day after the approval.`);
      needLock(f);
      if (!deps.write) throw new ReviewRefused(409, 'Nothing can be written to GitHub from here.');
      const pr = currentPr(fx);
      const body = String(text ?? v.remind.text).trim();
      if (!body) throw new ReviewRefused(400, 'The reminder is empty.');
      const res = await deps.write.comment({ yes: yesFor({ what: `Remind ${v.merge?.who ?? 'them'} to merge ${v.pr.label}` }), featureDir: f.dir, slug, repo: fx.repo, number: pr.number, body });
      if (!res.ok) throw new ReviewRefused(502, `GitHub didn’t take it: ${res.err}`);
      const mem = await prMemory(f);
      mem[pr.number] = { ...(mem[pr.number] ?? {}), remindedAt: iso() };
      await savePrMemory(f, mem);
      await deps.audit?.({ action: 'review-remind', featureDir: f.dir, slug, who: v.merge?.who ?? null, prLabel: v.pr.label });
      return refreshJob(slug);
    },
  });

  /** A round card's answer (lib/driver.js roundAnswer). */
  async function answerCard({ card, action, note }) {
    const fn = actions[action];
    if (!fn) throw new ReviewRefused(400, 'Unknown answer.');
    const body = action === 'send' || action === 'retry' || action === 'reopen' || action === 'sync' || action === 'fix-checks' ? { go: true, note } : { note };
    return fn(card.slug, body);
  }

  return {
    actions, answerCard, pass, refreshJob,
    /** Every job's review state, and the settings. */
    async list() { return { jobs: [...views.values()], settings: await settings() }; },
    async view(slug) {
      await jobOf(slug);
      return views.get(slug) ?? { slug, state: null };
    },
    async act(slug, action, body = {}) {
      const fn = actions[action];
      if (!fn) throw new ReviewRefused(404, 'Not found');
      return fn(slug, body);
    },
    settings,
    async setSettings(body = {}) {
      const patch = {};
      if (body.githubEveryMin !== undefined) {
        if (!GITHUB_EVERY_CHOICES.includes(body.githubEveryMin)) throw new ReviewRefused(400, `How often to check GitHub is every ${listWords(GITHUB_EVERY_CHOICES.map(String)).replace(' and ', ' or ')} minutes.`);
        patch.githubEveryMin = body.githubEveryMin;
      }
      if (body.mergeFollowUp !== undefined) {
        if (typeof body.mergeFollowUp !== 'boolean') throw new ReviewRefused(400, 'mergeFollowUp is true or false.');
        patch.mergeFollowUp = body.mergeFollowUp;
      }
      await deps.saveSettings?.({ ...(await settings()), ...patch });
      return settings();
    },
    /** A job is waiting on someone else: the flow map checks GitHub more often meanwhile. */
    isWaiting: () => [...views.values()].some((v) => WAITING_STATES.has(v.heldState ?? v.state)),
    /** A round is with the Foreman: the panel's items are re-read every few seconds. */
    isFixing: () => [...views.values()].some((v) => ['fixing', 'fix-stalled', 'new-comment'].includes(v.heldState ?? v.state)),
    busy,
    facts,
    /** Send back in progress for a job (a promise), or null: tests wait on it. */
    sendingNow: (slug) => inFlight.get(slug) ?? null,
  };
}

