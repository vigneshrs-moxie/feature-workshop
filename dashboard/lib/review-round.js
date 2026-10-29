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

import fs from 'node:fs/promises';
import path from 'node:path';
import { scrub, scrubDeep } from './orbit.js';
import { QUOTE_MAX, checkKey, commentKey, isSummaryBot } from './pr-feedback.js';

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

function newRound({ number, prNumber, prLabel, prUrl, author, first, head, at }) {
  return {
    version: 1, round: number, pr: prNumber, prLabel, prUrl: prUrl ?? null, reviewer: author,
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
 *   by key (N's states); firstLook: this PR was never looked at (N's lookedAt); pr: { number, label, url }.
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
  const open = (author) => all.filter((r) => r.pr === pr.number && r.reviewer === author && GATHERING.has(r.state)).at(-1) ?? null;
  const hadRound = (author) => all.some((r) => r.pr === pr.number && r.reviewer === author);
  const startRound = (author, first) => {
    const r = newRound({ number: next++, prNumber: pr.number, prLabel: pr.label, prUrl: pr.url, author, first, head, at });
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
    const gathering = all.filter((r) => r.pr === pr.number && GATHERING.has(r.state) && (!r.head || r.head === head)).at(-1) ?? null;
    const sentWith = all.filter((r) => r.pr === pr.number && ['sent', 'check-failed'].includes(r.state) && r.sentHead === head).at(-1) ?? null;
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
  round.foreman = { state: report.state ?? null, doing: report.doing ?? null, next: report.next ?? null, checks: report.checks ?? null, at: round.foreman?.at ?? at };
  for (const r of report.items ?? []) {
    const item = round.items.find((i) => i.id === r.id);
    if (!item) continue;
    if (r.kind && KINDS.includes(r.kind) && item.kindBy !== 'you' && item.type !== 'check') { item.kind = r.kind; item.kindBy = 'foreman'; }
    if (r.plan && PLANS.has(r.plan)) item.plan = r.plan;
    if (r.planText != null) item.planText = cut(r.planText, 400);
    if (!item.included) continue;
    if (r.state && FOREMAN_ITEM_STATES.has(r.state)) item.state = r.state;
    if (r.commit) item.commit = String(r.commit).slice(0, 40);
    if (r.reason != null) item.reason = cut(r.reason, 1000);
    if (r.reply != null && !item.replyEdited && item.type !== 'check') item.reply = cut(r.reply, QUOTE_MAX);
  }
  const after = JSON.stringify([round.items, round.foreman]);
  if (before !== after) round.foreman.at = at;
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
    if (i.type === 'check') out.push(`${head}\nThe end of its log:\n${i.log ? fenced(i.log) : '(Its log couldn’t be read. Look at the check on GitHub, read only.)'}${i.link ? `\nThe check on GitHub: ${i.link}` : ''}`);
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
  const comments = items.filter((i) => i.type !== 'check' && i.kind !== 'question').length;
  const questions = items.filter((i) => i.type !== 'check' && i.kind === 'question').length;
  return listWords([comments ? plural(comments, 'comment') : null, questions ? plural(questions, 'question') : null].filter(Boolean)).replace(' and ', ', ') || 'no comments';
}

const checkNames = (items) => listWords(items.filter((i) => i.type === 'check').map((i) => i.name));

// Group the panel's items by file, the whole-PR ones next, the checks last.
function groupsOf(items) {
  const groups = new Map();
  for (const i of items) {
    const key = i.type === 'check' ? '\u0002checks' : i.file ?? '\u0001general';
    if (!groups.has(key)) groups.set(key, { heading: i.type === 'check' ? 'Checks on the same commit' : i.file ?? 'On the whole pull request', file: i.type === 'check' ? null : i.file ?? null, items: [] });
    groups.get(key).items.push(i);
  }
  return [...groups.entries()].sort(([a], [b]) => (a.startsWith('\u0002') ? 1 : 0) - (b.startsWith('\u0002') ? 1 : 0) || (a.startsWith('\u0001') ? 1 : 0) - (b.startsWith('\u0001') ? 1 : 0) || a.localeCompare(b)).map(([, g]) => g);
}

function replyState(i) {
  if (i.type === 'check') return null;
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
    reply: i.type === 'check' ? null : i.reply, replyDropped: Boolean(i.replyDropped), replyState: replyState(i), reason: i.reason,
    late: Boolean(i.late), newWords: i.late && !i.added ? `New · joined round ${round.round}` : null,
    changeAfterAll: i.included && i.state === 'wont_change' ? action('change-after-all', 'Change it after all', { go: null }) : null,
  });
  const included = added.filter((i) => i.included).length;
  const done = added.filter((i) => i.included && ['fixed', 'answered', 'wont_change'].includes(i.state)).length;
  return {
    round: round.round, pr: round.pr, prLabel: round.prLabel, state: round.state, title: `Round ${round.round} · ${round.prLabel}`,
    from: fromWords, reviewer: { login: round.reviewer, name: who },
    counts: { items: added.length, included, done, commits: new Set(added.filter((i) => i.commit).map((i) => i.commit)).size, replies: added.filter((i) => i.included && i.reply && i.type !== 'check').length },
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
  const replies = items.filter((i) => i.type !== 'check' && i.reply && !i.replyDropped && !i.posted?.ok);
  const checkItems = items.filter((i) => i.type === 'check');
  if (replies.length) steps.push({ id: 'replies', words: `Reply on GitHub to each of ${who}’s ${plural(replies.length, 'comment')}`, detail: `Each drafted reply below: edit or drop any of them.${checkItems.length ? ` The ${checkNames(checkItems)} check${checkItems.length > 1 ? 's get' : ' gets'} no reply; the push runs ${checkItems.length > 1 ? 'them' : 'it'} again.` : ''}`, count: replies.length });
  const resolve = items.filter((i) => i.type === 'line' && i.state === 'fixed' && !i.resolved);
  if (resolve.length) steps.push({ id: 'resolve', words: `Mark the ${plural(resolve.length, 'fixed comment')} resolved`, detail: 'Only the ones Fixed: not the answered question or the one kept as it is', count: resolve.length });
  const reviewer = routeStep(route, round.pr).reviewer;
  if (round.reviewer && !reviewer?.you && !round.requestedAt) steps.push({ id: 'request', words: `Ask ${who} to review ${label} again`, detail: `gh pr edit · re-request review from ${who}` });
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
    const detail = [
      failed?.error ? `GitHub had a problem${failed.code ? ` (${failed.code})` : ''}: ${failed.error}` : round.send?.stopAfter ? 'You asked it to stop after that step.' : null,
      done.length ? `${done.length === 1 ? 'Step' : 'Steps'} ${listWords(done.map((s) => String(s.number)))} ${done.length === 1 ? 'is' : 'are'} done` : null,
      posted ? `${plural(posted, 'reply', 'replies')} ${posted === 1 ? 'is' : 'are'} posted` : null,
      notRun.length ? `${notRun.length === 1 ? 'step' : 'steps'} ${listWords(notRun.map((s) => String(s.number)))} didn’t run` : null,
    ].filter(Boolean).join('. ').replace(/\. ([a-z])/g, (m, c) => `, and ${c}`);
    const bar = { headline, detail: `${detail}.`, actions: [action('retry', 'Try again from here', { key: 'a', go: true }), action('not-yet', 'Not yet', { key: 'r', go: false })] };
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
    const canRemind = now >= remindAt && !(round?.remindedAt && now - ms(round.remindedAt) < REMIND_AFTER_MS);
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
