// A pull request's comments as rows on the job page (the job page rebuild, Task 21; design brief R3;
// phase4-design.md Ruling 2): one list of rows is the truth. Every comment not answered yet is a row,
// including the ones made before Starbase first looked and the ones from his own login (the opposite of
// lib/pr-feedback.js's seeding and `me` skip, which stay for its Desk cards only). Summary bots are left out.
//
//   rowsOf(o)              pure: GitHub's comments (lib/git.js prComments, prConversation), his and the
//                          Foreman's marks, the Foreman's answers and the review rounds' items → rows
//   parseCommentsAnswered(reply)   the Foreman's `--- Comments answered ---` block (strict fences)
//   answersOf(thread)      every block line in the job's conversation, by comment id, the newest winning
//   fixMessage / askMessage / checkMessage   what `Fix these`, `What is he asking?` and `Fix it` send
//   stateWords(row)        `New`, `Fixing`, `Fixed in abc1234`, `Answered`, `Left`
//   readKept / markRows    <job>/pr-comments.json: only his and the Foreman's marks are kept; the comments
//                          themselves are read again each time
//   createPrComments(deps) the runner's half: the read after each network refresh of the flow map (for jobs
//                          the new page has open or cached), and each job's rows at its page's rebuild
//
// A line-comment thread is one row, under its first comment's id (`c<id>`); a review's own text is `r<id>`
// (only a "Request changes" or "Comment" review); a conversation comment is `i<id>`. Ids are
// lib/git.js prComments' ids, so a pr-feedback card's item and a round's item name the same row.
//
// A row is answered only by a line of a `--- Comments answered ---` block, a mark of his (Fix these: `Fixing`;
// Leave: `Left`; Post it: posted) or a review round's item; his own later comments answer nothing. A
// reviewer's reply in the thread after the answer opens the row again (`New`).
//
// Row { id, kind: 'line' | 'review' | 'conversation', author, mine, file, line, outdated, body, context
//       (the three code lines it sits on, or null), contextAt (the first one's number), link, at,
//       replies: [{ author, mine, body, at }], state: 'new' | 'fixing' | 'fixed' | 'answered' | 'left',
//       commit (short sha) | null, why | null, reply: { draft, posted } | null, number (the PR's) }
//
// Nothing here writes to GitHub: Post it is lib/gh-write.js's reply, on his click (runner/index.js).

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomic-write.js';
import { QUOTE_MAX, feedbackMessage, isSummaryBot } from './pr-feedback.js';
import { scrub } from './orbit.js';

export const COMMENTS_FILE = 'pr-comments.json';
export const ROW_STATES = Object.freeze(['new', 'fixing', 'fixed', 'answered', 'left']);
/** The review states whose text is a comment to answer (as lib/review-round.js candidatesOf). */
const ASKING_REVIEWS = new Set(['CHANGES_REQUESTED', 'COMMENTED']);
/** Lines a failed check shows (the end of its failed log). */
export const CHECK_LINES = 40;

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const ms = (at) => { const t = Date.parse(at ?? ''); return Number.isFinite(t) ? t : null; };
const short = (sha) => (sha ? String(sha).slice(0, 7) : null);
const clean = (text) => scrub(String(text ?? '')).replace(/\r/g, '');
const lower = (s) => String(s ?? '').toLowerCase();

/** A row's state in words: `New`, `Fixing`, `Fixed in abc1234`, `Answered`, `Left`. */
export function stateWords(row) {
  switch (row?.state) {
    case 'fixing': return 'Fixing';
    case 'fixed': return row.commit ? `Fixed in ${short(row.commit)}` : 'Fixed';
    case 'answered': return 'Answered';
    case 'left': return 'Left';
    default: return 'New';
  }
}

/** The last three lines of GitHub's diff hunk (the comment's line and the two above it), without the diff marks. */
export function hunkLines(hunk) {
  const lines = String(hunk ?? '').split('\n').filter((l) => !l.startsWith('@@') && !l.startsWith('-'));
  if (!lines.length || !String(hunk ?? '').trim()) return null;
  return lines.slice(-3).map((l) => (l.startsWith('+') || l.startsWith(' ') ? l.slice(1) : l));
}

/** The three lines a comment sits on (its line, one above, one below) out of a file's text. */
export function linesAround(text, line) {
  if (typeof text !== 'string' || !Number.isInteger(line) || line < 1) return null;
  const all = text.split('\n');
  if (line > all.length) return null;
  const from = Math.max(1, line - 1);
  return { at: from, lines: all.slice(from - 1, Math.min(all.length, line + 1)) };
}

// ---------- The Foreman's answer ----------

const COMMENTS_ANSWERED = '--- Comments answered ---';
const ANSWER_END = '--- End ---';
const ANSWER_LINE = /^([cri]\d+)\s*·\s*(?:fixed in\s+([0-9a-f]{7,40})|(answered)|left\s*·\s*([^·]+?))\s*·\s*reply:\s*(.+)$/i;

/**
 * The Foreman's answers to PR comments, read from the last `--- Comments answered ---` block of its reply
 * (the fence lines alone on their lines, spelt exactly; the block ends at the first `--- End ---` after it).
 * A line that is not an answer is left out; no block gives [].
 * @returns {{ id: string, state: 'fixed' | 'answered' | 'left', commit: string | null, why: string | null, reply: string }[]}
 */
export function parseCommentsAnswered(reply) {
  const lines = String(reply ?? '').split(/\r?\n/).map((l) => l.trim());
  const start = lines.lastIndexOf(COMMENTS_ANSWERED);
  if (start < 0) return [];
  const end = lines.indexOf(ANSWER_END, start + 1);
  if (end < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1, end)) {
    const m = ANSWER_LINE.exec(line);
    if (!m) continue;
    const id = m[1].toLowerCase();
    const replyText = m[5].trim();
    if (m[2]) out.push({ id, state: 'fixed', commit: m[2].toLowerCase(), why: null, reply: replyText });
    else if (m[3]) out.push({ id, state: 'answered', commit: null, why: null, reply: replyText });
    else out.push({ id, state: 'left', commit: null, why: m[4].trim(), reply: replyText });
  }
  return out;
}

/** Every answer line in the job's conversation (lib/thread.js items; a reply's text is the audit's keptReply), by id; a later one wins. */
export function answersOf(thread) {
  const out = new Map();
  for (const it of Array.isArray(thread) ? thread : []) {
    if (it?.kind !== 'reply') continue;
    for (const a of parseCommentsAnswered(it.reply ?? '')) out.set(a.id, { ...a, at: it.at ?? null });
  }
  return out;
}

// ---------- The rows ----------

/** A review round item's mark (lib/review-round.js item states): fixed, answered, or kept as it is. */
function roundMark(item) {
  const state = item.state === 'fixed' ? 'fixed' : item.state === 'answered' ? 'answered' : item.state === 'wont_change' ? 'left' : null;
  if (!state) return null;
  const draft = typeof item.reply === 'string' && item.reply.trim() ? item.reply : null;
  return { state, commit: item.commit ? short(item.commit) : null, why: item.reason ?? null, reply: draft ? { draft, posted: item.posted ? draft : null } : null, at: item.postedAt ?? item.at ?? null, from: 'round' };
}

/**
 * The rows of one PR. Pure.
 *   comments      lib/git.js prComments(): line comments (replyTo, hunk) and reviews with a body (reviewState)
 *   conversation  lib/git.js prConversation(): the PR's conversation comments
 *   me            his GitHub login(s): his comments are rows too, marked `mine`
 *   kept          pr-comments.json's marks for this PR: { [id]: { state, commit, reply, why, at } }
 *   answers       answersOf(thread): the Foreman's block lines, by id
 *   rounds        the review rounds' items on this PR, by id (lib/review-round.js readRounds)
 *   context       id → { at, lines }: the three code lines a line comment sits on, from the PR's head
 *   number        the PR's number on GitHub
 */
export function rowsOf({ comments = [], conversation = [], me = [], kept = {}, answers = new Map(), rounds = new Map(), context = new Map(), number = null } = {}) {
  const mine = new Set((Array.isArray(me) ? me : [me]).filter(Boolean).map(lower));
  const isMine = (who) => mine.has(lower(who));
  const all = [...(comments ?? []), ...(conversation ?? [])]
    .filter((c) => c?.id && String(c.body ?? '').trim() && !isSummaryBot(c.author))
    .filter((c) => c.kind !== 'review' || !c.reviewState || ASKING_REVIEWS.has(c.reviewState))
    .sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || String(a.id).localeCompare(String(b.id)));
  const roots = new Map();
  const rootOf = new Map();
  for (const c of all) {
    const root = c.kind === 'line' && c.replyTo && roots.has(c.replyTo) ? roots.get(c.replyTo) : null;
    if (root) { root.replies.push(c); rootOf.set(c.id, root.c.id); continue; }
    roots.set(c.id, { c, replies: [] });
    rootOf.set(c.id, c.id);
  }
  // An answer or a round item named by a reply in a thread answers the thread.
  const byRoot = (map) => {
    const out = new Map();
    for (const [id, v] of map instanceof Map ? map : Object.entries(map ?? {})) {
      const root = rootOf.get(id) ?? id;
      const was = out.get(root);
      if (!was || (ms(v?.at) ?? 0) >= (ms(was.at) ?? 0)) out.set(root, v);
    }
    return out;
  };
  const answered = byRoot(answers);
  const inRounds = byRoot(rounds);
  const keptBy = isRecord(kept) ? kept : {};
  return [...roots.values()].map(({ c, replies }) => {
    const ctx = context instanceof Map ? context.get(c.id) ?? null : null;
    const hunk = c.kind === 'line' && !ctx ? hunkLines(c.hunk) : null;
    const row = {
      id: c.id, kind: c.kind === 'review' ? 'review' : c.kind === 'conversation' ? 'conversation' : 'line', number,
      author: c.author ?? 'someone', mine: isMine(c.author), file: c.file ?? null, line: Number.isInteger(c.line) ? c.line : null, outdated: Boolean(c.outdated),
      body: String(c.body), context: ctx?.lines ?? hunk ?? null, contextAt: ctx?.at ?? (hunk && Number.isInteger(c.line) ? Math.max(1, c.line - hunk.length + 1) : null),
      link: c.link ?? null, at: c.at ?? null,
      replies: replies.map((r) => ({ author: r.author ?? 'someone', mine: isMine(r.author), body: String(r.body), at: r.at ?? null })),
      state: 'new', commit: null, why: null, reply: null,
    };
    // The newest mark wins: a round's item, his own (Fix these, Leave, Post it), the Foreman's answer.
    const marks = [];
    const r = inRounds.get(c.id);
    if (r) { const m = roundMark(r); if (m) marks.push(m); }
    const k = keptBy[c.id];
    if (isRecord(k) && ROW_STATES.includes(k.state) && k.state !== 'new') marks.push({ ...k, from: 'kept' });
    const a = answered.get(c.id);
    if (a) marks.push({ state: a.state, commit: a.commit ?? null, why: a.why ?? null, reply: { draft: a.reply, posted: null }, at: a.at ?? null, from: 'answer' });
    const rank = { round: 0, kept: 1, answer: 2 };
    marks.sort((x, y) => ((ms(x.at) ?? 0) - (ms(y.at) ?? 0)) || rank[x.from] - rank[y.from]);
    const mark = marks.at(-1) ?? null;
    if (mark) {
      row.state = mark.state;
      row.commit = mark.commit ? short(mark.commit) : null;
      row.why = mark.why ?? null;
      row.reply = mark.reply ? { draft: String(mark.reply.draft ?? ''), posted: mark.reply.posted ?? null } : null;
      // A reply in the thread from someone else, after the answer (not after his Fix these), opens it again.
      const lastOther = replies.filter((x) => !isMine(x.author)).map((x) => ms(x.at)).filter((t) => t !== null).sort((p, q) => p - q).at(-1) ?? null;
      const markAt = ms(mark.at);
      if (mark.state !== 'fixing' && lastOther !== null && markAt !== null && lastOther > markAt) Object.assign(row, { state: 'new', commit: null, why: null, reply: null });
    }
    return row;
  });
}

/** How many rows are new, how many in all, how many fixed (their commits wait for Push the fixes). */
export function countsOf(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return { fresh: list.filter((r) => r.state === 'new').length, total: list.length, fixed: list.filter((r) => r.state === 'fixed').length };
}

// ---------- What goes to the Foreman ----------

const where = (row) => (row.kind === 'line' ? `${row.file ?? 'a file'}${row.line ? ` line ${row.line}` : ''}${row.outdated ? ' (outdated)' : ''}` : row.kind === 'review' ? 'review' : 'conversation');
const quote = (text) => {
  const s = clean(text).trim();
  const cut = s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1)}…` : s;
  return cut.split('\n').map((l) => `   > ${l}`.trimEnd());
};

/** The block both messages quote: each comment's id, where it is, who wrote it, and its words. */
function commentsBlock(rows) {
  const lines = [`--- PR comments (${rows.length}) ---`];
  for (const r of rows) {
    lines.push(`${r.id} · ${where(r)} · ${clean(r.author)}`);
    lines.push(...quote(r.body));
    for (const x of r.replies ?? []) {
      lines.push(`   ${clean(x.author)} replied:`);
      lines.push(...quote(x.body).map((l) => `  ${l}`));
    }
  }
  lines.push('--- End of PR comments ---');
  return lines.join('\n');
}

const prName = (pr) => `${pr?.label ?? 'the pull request'}${pr?.number ? ` (#${pr.number})` : ''}`;

/** Fix these: one prepared message quoting each ticked comment (id, file, line, words). */
export function fixMessage(rows, pr = {}) {
  const n = rows.length;
  return `Please fix ${n === 1 ? 'this review comment' : `these ${n} review comments`} on ${prName(pr)} on this branch, one commit per comment. Don't push, and don't reply, resolve or ask for a review on GitHub. Answer with the \`--- Comments answered ---\` block: one line per comment with the commit that fixed it and a drafted reply.\n\n${commentsBlock(rows)}`;
}

/** What is he asking?: the same comments, to be explained in words, with nothing changed. */
export function askMessage(rows, pr = {}) {
  const n = rows.length;
  return `What ${n === 1 ? 'is this review comment' : `are these ${n} review comments`} on ${prName(pr)} asking for? Explain each in a sentence or two and say what you would change. Change nothing yet, and don't reply on GitHub.\n\n${commentsBlock(rows)}`;
}

/** Fix it: a failed check's end of log, to fix on this branch (lib/pr-feedback.js feedbackMessage's words). */
export function checkMessage(check, pr = {}) {
  return feedbackMessage({ kind: 'check', pr: { label: prName(pr) }, name: check.name, log: check.log ?? '', link: check.link ?? null });
}

// ---------- pr-comments.json ----------

const fileOf = (dir) => path.join(dir, COMMENTS_FILE);

/** The job's marks: { prs: { [number]: { rows: { [id]: { state, commit, reply, why, at } }, checks: { [key]: { state, at } } } }, readAt }. */
export async function readKept(dir) {
  try {
    const data = JSON.parse(await fs.readFile(fileOf(dir), 'utf8'));
    return { prs: isRecord(data?.prs) ? data.prs : {}, readAt: typeof data?.readAt === 'string' ? data.readAt : null };
  } catch { return { prs: {}, readAt: null }; }
}

const writing = new Map();
/** One write at a time per file, each on top of the last: change(data) edits the record read fresh. */
export function updateKept(dir, change) {
  const file = fileOf(dir);
  const next = (writing.get(file) ?? Promise.resolve()).then(async () => {
    const data = await readKept(dir);
    const out = change(data);
    await writeFileAtomic(file, `${JSON.stringify({ version: 1, prs: data.prs, readAt: data.readAt }, null, 2)}\n`, { mode: 0o600 });
    return out;
  });
  const kept = next.catch(() => {});
  writing.set(file, kept);
  kept.then(() => { if (writing.get(file) === kept) writing.delete(file); });
  return next;
}

/** Mark rows of one PR (Fix these: fixing; Leave: left; Post it: the row as it is, with its reply posted). */
export function markRows(dir, number, marks, at = new Date().toISOString()) {
  return updateKept(dir, (data) => {
    const pr = (data.prs[number] = isRecord(data.prs[number]) ? data.prs[number] : {});
    pr.rows = isRecord(pr.rows) ? pr.rows : {};
    for (const [id, m] of Object.entries(marks)) pr.rows[id] = { state: m.state, commit: m.commit ?? null, why: m.why ?? null, reply: m.reply ?? null, at };
  });
}

/** Mark a failed check (Fix it: fixing), by its name and the commit it failed on. */
export const checkKeyOf = (c) => `${c.name}@${c.head ?? 'unknown'}`;
export function markCheck(dir, number, check, state, at = new Date().toISOString()) {
  return updateKept(dir, (data) => {
    const pr = (data.prs[number] = isRecord(data.prs[number]) ? data.prs[number] : {});
    pr.checks = isRecord(pr.checks) ? pr.checks : {};
    pr.checks[checkKeyOf(check)] = { state, at };
  });
}

// ---------- The runner's half ----------

const SHA = /^[0-9a-f]{7,40}$/;
const FILE = /^(?!-)(?!.*\.\.)[^\0:]{1,400}$/;

/**
 * deps:
 *   gh                 read-only gh runner (lib/git.js ghRunner), or null: nothing is read
 *   git                { prComments, prConversation, prChecks, failedLog, ghLogin } (lib/git.js)
 *   read(dir, args)    read-only git in a worktree (lib/review-round.js gitRead): cat-file for the code lines
 *   jobs()             the jobs (runner features): { slug, dir, closed }
 *   wanted(slug)       the new page has this job open or cached (jobPages.has)
 *   codeDir(f)         the job's own worktree (never a guessed branch's), or null
 *   touch(slug)        the job's page rebuilds
 *   rounds(dir)        lib/review-round.js readRounds
 *   now()
 */
export function createPrComments(deps) {
  const now = deps.now ?? (() => Date.now());
  const raw = new Map(); // slug → Map(number → { n, number, url, head, comments, conversation, checks, readAt, problem })
  const logs = new Map(); // runId → the failed log's last lines
  const files = new Map(); // `${dir}\0${sha}:${file}` → the file's text (or null)
  const meOf = new Map(); // slug → his logins (the fork's owner and gh's login)
  let me;
  let passing = Promise.resolve();

  async function fileText(dir, sha, file) {
    if (!dir || !SHA.test(String(sha ?? '')) || !FILE.test(String(file ?? ''))) return null;
    const key = `${dir}\0${sha}:${file}`;
    if (files.has(key)) return files.get(key);
    const res = await deps.read?.(dir, ['cat-file', '-p', `${sha}:${file}`]).catch(() => null);
    const text = res?.ok ? res.out : null;
    files.set(key, text);
    if (files.size > 200) files.delete(files.keys().next().value);
    return text;
  }

  async function readPr(f, repo, n, lanePr) {
    const number = lanePr.number;
    const at = new Date(now()).toISOString();
    const was = raw.get(f.slug)?.get(number) ?? null;
    try {
      const comments = await deps.git.prComments(repo, number, { gh: deps.gh });
      const conversation = await deps.git.prConversation(repo, number, { gh: deps.gh });
      const checks = await deps.git.prChecks(repo, number, { gh: deps.gh }).catch(() => null);
      const head = checks?.head ?? lanePr.head ?? null;
      const failed = [];
      for (const c of checks?.checks ?? []) {
        if (c.state !== 'fail') continue;
        let log = c.runId ? logs.get(c.runId) : null;
        if (log === undefined || log === null) {
          log = c.runId ? await deps.git.failedLog(repo, c.runId, { gh: deps.gh, lines: CHECK_LINES }).catch(() => null) : null;
          if (c.runId && log !== null) { logs.set(c.runId, log); if (logs.size > 100) logs.delete(logs.keys().next().value); }
        }
        failed.push({ name: c.name, link: c.link ?? null, runId: c.runId ?? null, head, log: log ? clean(log) : null });
      }
      // The three code lines each line comment sits on, from the PR's newest commit in the job's worktree.
      const context = new Map();
      const dir = deps.codeDir?.(f) ?? null;
      for (const c of comments) {
        if (c.kind !== 'line' || c.replyTo || !c.file || !Number.isInteger(c.line) || c.outdated) continue;
        const around = linesAround(await fileText(dir, head, c.file), c.line);
        if (around) context.set(c.id, around);
      }
      return { n, number, url: lanePr.url ?? null, head, comments, conversation, checks: failed, context, readAt: at, problem: null };
    } catch (err) {
      return { ...(was ?? { n, number, url: lanePr.url ?? null, head: null, comments: [], conversation: [], checks: [], context: new Map(), readAt: null }), problem: `GitHub couldn’t be read: ${String(err?.message ?? err).split('\n')[0]}` };
    }
  }

  /** After a network refresh of the flow map (view: its view): the PRs of each job the new page has. One pass at a time. */
  function pass(view) {
    passing = passing.then(() => passNow(view)).catch((err) => deps.problem?.(err));
    return passing;
  }
  async function passNow(view) {
    if (!deps.gh || !view) return;
    const jobs = await deps.jobs();
    if (me === undefined) me = (await deps.git.ghLogin?.({ gh: deps.gh }).catch(() => null)) ?? null;
    for (const r of view.repos ?? []) {
      const repo = r.org?.slug ?? r.fork?.slug ?? null;
      if (!r.prsKnown || !repo) continue;
      for (const lane of r.lanes ?? []) {
        const f = jobs.find((j) => j.slug === lane.slug);
        if (!f || f.closed || !deps.wanted(f.slug)) continue;
        const prs = new Map();
        for (const [n, p] of [[1, lane.pr1], [2, lane.pr2]]) {
          if (!p?.number || !['open', 'draft'].includes(p.state)) continue;
          prs.set(p.number, await readPr(f, repo, n, p));
        }
        raw.set(f.slug, prs);
        meOf.set(f.slug, [r.fork?.slug?.split('/')[0], ...(Array.isArray(me) ? me : [me])].filter(Boolean));
        await updateKept(f.dir, (data) => { data.readAt = new Date(now()).toISOString(); }).catch(() => {});
        deps.touch?.(f.slug);
      }
    }
  }

  /**
   * One job's PRs as the page shows them, at its rebuild: { [n]: { n, number, url, rows, checks, verdict,
   * readAt, problem, fresh, total, fixed } }. thread: the job's whole conversation (the Foreman's answers).
   * No GitHub and no git: what the last read kept, his marks (pr-comments.json) and the review rounds' items.
   */
  async function factsOf(f, thread = []) {
    const prs = raw.get(f.slug);
    if (!prs || !prs.size) { last.delete(f.slug); return {}; }
    const kept = await readKept(f.dir);
    const answers = answersOf(thread);
    const rounds = (await deps.rounds?.(f.dir).catch(() => [])) ?? [];
    const out = {};
    for (const p of prs.values()) {
      const roundItems = new Map();
      const its = rounds.filter((x) => x.prNumber === p.number);
      for (const round of its) for (const i of round.items ?? []) if (i.id && i.type !== 'check') roundItems.set(i.id, i);
      const pk = isRecord(kept.prs[p.number]) ? kept.prs[p.number] : {};
      const rows = rowsOf({ comments: p.comments, conversation: p.conversation, me: meOf.get(f.slug) ?? [], kept: pk.rows ?? {}, answers, rounds: roundItems, context: p.context, number: p.number });
      const checkMarks = isRecord(pk.checks) ? pk.checks : {};
      const checks = p.checks.map((c) => ({ ...c, state: checkMarks[checkKeyOf(c)]?.state === 'fixing' ? 'fixing' : 'failed' }));
      const round = [...its].reverse().find((x) => x.state !== 'done') ?? null;
      const review = [...p.comments].reverse().find((c) => c.kind === 'review' && c.reviewState) ?? null;
      const verdict = round?.reviewState
        ? { by: round.reviewer ?? null, state: String(round.reviewState).toLowerCase(), at: round.reviewAt ?? null }
        : review ? { by: review.author, state: String(review.reviewState).toLowerCase(), at: review.at ?? null } : null;
      const since = rows.filter((r) => r.state === 'new').map((r) => r.at).filter(Boolean).sort()[0] ?? null;
      const body = { number: p.number, url: p.url, rows, checks, verdict, readAt: p.readAt ?? kept.readAt, problem: p.problem };
      // v: the rows' version (the page asks for them again when it moves; a new read moves it, so `read just now` shows).
      const v = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 12);
      out[p.n] = { n: p.n, ...body, ...countsOf(rows), failing: checks.length, since, v };
    }
    last.set(f.slug, out);
    return out;
  }
  const last = new Map(); // slug → factsOf's last answer (the PR line's yes is checked against what the page showed)

  return { pass, factsOf, lastOf: (slug) => last.get(slug) ?? {}, has: (slug) => raw.has(slug), raw, passing: () => passing };
}
