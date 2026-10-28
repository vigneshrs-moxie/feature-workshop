// Failed checks and review comments on a job's pull request, sent back to its Foreman (packet N).
//
// After each network refresh of the flow map (lib/flow.js FlowWatch, every ten minutes or on
// Refresh), the runner reads each open job's open PRs with the read-only gh helpers in lib/git.js
// (prChecks, prComments, failedLog) and asks findNew() what it hasn't seen yet. Each new item
// becomes one Needs you card (lib/driver.js parkFeedbackCard); nothing goes to the Foreman until you
// press "Send it to the Foreman", and nothing is ever written to GitHub.
//
//   findNew()          pure: the failed checks and comments not seen before, once each. A check is
//                      keyed by its name and the PR's newest commit, so one that fails again after
//                      a new push is new. Skipped: comments by you, by bots that only post
//                      summaries (SUMMARY_BOTS), and anything on a closed job or a PR no job owns.
//   ownerOf()          the job whose branch is the PR's head branch, or null
//   cardWords()        the card's words: "A check failed on PR #1: lint." and the quote
//   feedbackMessage()  what the Foreman gets: the failure or comment, scrubbed (lib/orbit.js) and
//                      cut to QUOTE_MAX characters, with what to do and not to do
//   readFeedback() / noteFeedback()
//                      pr-feedback.json in the job folder: every item found, by key, with its state
//                      ('waiting' while its card is up, 'queued' while it waits for a reply to end,
//                      'sent', 'left'), so a restart parks the waiting cards again and never asks twice.

import fs from 'node:fs/promises';
import path from 'node:path';
import { scrub, scrubDeep } from './orbit.js';

export const FEEDBACK_FILE = 'pr-feedback.json';
/** The most quoted text one message carries (characters). */
export const QUOTE_MAX = 4000;
/** The card's two answers (a question card also offers "Something else": your own words). */
export const FEEDBACK_SEND = 'Send it to the Foreman';
export const FEEDBACK_LEAVE = 'Leave it';

/** Bots whose comments are summaries (coverage, previews, scans), never something to answer. Lower case. */
export const SUMMARY_BOTS = Object.freeze([
  'github-actions', 'codecov', 'codecov-commenter', 'vercel', 'netlify', 'sonarcloud', 'sonarqubecloud',
  'changeset-bot', 'linear', 'railway-app', 'render', 'cloudflare-pages', 'cloudflare-workers-and-pages',
]);

const botName = (login) => String(login ?? '').toLowerCase().replace(/\[bot\]$/, '');
export const isSummaryBot = (login) => SUMMARY_BOTS.includes(botName(login));

/** The key of a failed check: the PR, the check's name and the commit it failed on. */
export const checkKey = (pr, name, head) => `pr${pr.number}:check:${name}@${head ?? 'unknown'}`;
/** The key of a comment: the PR and GitHub's id for it. */
export const commentKey = (pr, id) => `pr${pr.number}:comment:${id}`;

/** The job that owns a PR: the one whose branch is its head branch (closed jobs included; findNew skips them). */
export function ownerOf(pr, jobs) {
  if (!pr?.head) return null;
  return (jobs ?? []).find((j) => j.branch && j.branch === pr.head) ?? null;
}

/**
 * What is new on one PR. job: { slug, branch, closed }. pr: { number, label ('PR #1'), head (its
 * branch), headSha, url }. checks: lib/git.js prChecks().checks. comments: lib/git.js prComments().
 * seen: the keys already found (an object by key, a Set or an array). me: your GitHub login(s).
 * Returns [{ key, kind: 'check' | 'comment', pr: { number, label, url }, … }], each key once.
 */
export function findNew({ job, pr, checks = [], comments = [], seen = {}, me = null }) {
  if (!job || job.closed || !pr || pr.head !== job.branch) return [];
  const known = seen instanceof Set ? seen : new Set(Array.isArray(seen) ? seen : Object.keys(seen ?? {}));
  const mine = new Set((Array.isArray(me) ? me : [me]).filter(Boolean).map((m) => String(m).toLowerCase()));
  const where = { number: pr.number, label: pr.label ?? `PR #${pr.number}`, url: pr.url ?? null };
  const out = [];
  const add = (item) => { if (!known.has(item.key) && !out.some((x) => x.key === item.key)) out.push(item); };
  for (const c of checks ?? []) {
    if (c?.state !== 'fail') continue;
    add({ key: checkKey(pr, c.name, pr.headSha), kind: 'check', pr: where, name: c.name, link: c.link ?? null, runId: c.runId ?? null, head: pr.headSha ?? null });
  }
  for (const c of comments ?? []) {
    if (!c?.id || !String(c.body ?? '').trim()) continue;
    if (mine.has(String(c.author ?? '').toLowerCase())) continue;
    if (isSummaryBot(c.author)) continue;
    add({ key: commentKey(pr, c.id), kind: 'comment', pr: where, id: c.id, author: c.author ?? 'someone', file: c.file ?? null, line: c.line ?? null, body: c.body, link: c.link ?? null, at: c.at ?? null });
  }
  return out;
}

// ---------- Words ----------

const clean = (text) => scrub(String(text ?? '')).replace(/\r/g, '');
/** The end of a log, scrubbed and cut to `max` characters (cut from the front). */
const tailOf = (text, max) => { const s = clean(text).trim(); return s.length > max ? `…${s.slice(s.length - max + 1)}` : s; };
/** The start of a comment, scrubbed and cut to `max` characters. */
const headOf = (text, max) => { const s = clean(text).trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };

const where = (item) => (item.file ? `${item.file}${item.line ? ` line ${item.line}` : ''}` : null);

/** The card's headline, its short quote and its question. */
export function cardWords(item) {
  const label = item.pr?.label ?? 'the pull request';
  if (item.kind === 'check') {
    const headline = `A check failed on ${label}: ${clean(item.name)}.`;
    const lines = tailOf(item.log ?? '', 2000).split('\n').map((l) => l.trim()).filter(Boolean).slice(-3);
    const quote = lines.length ? `The end of its log: “${headOf(lines.join(' / '), 300)}”.` : 'Its log couldn’t be read.';
    return { headline, quote, question: `${headline} ${quote} Send it to the Foreman?` };
  }
  const at = where(item);
  const headline = `${clean(item.author)} commented on ${label}${at ? `, ${clean(at)}` : ''}.`;
  const lines = clean(item.body).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
  const quote = `“${headOf(lines.join(' / '), 300)}”`;
  return { headline, quote, question: `${headline} ${quote} Send it to the Foreman?` };
}

// A code block whose fence is longer than any run of backticks in the text.
function fenced(text) {
  const longest = Math.max(0, ...[...String(text).matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

/** The message the Foreman gets on "Send it to the Foreman". extra: your own words, put first. */
export function feedbackMessage(item, { extra = null } = {}) {
  const label = item.pr?.label ?? 'the pull request';
  let text;
  if (item.kind === 'check') {
    const log = tailOf(item.log ?? '', QUOTE_MAX);
    text = `A check failed on ${label}: ${clean(item.name)}. The end of its log is below. Fix it on this branch, run the tests, and commit. Don't push.\n\n${log ? fenced(log) : '(Its log couldn’t be read. Look at the check on GitHub, read only.)'}${item.link ? `\n\nThe check on GitHub: ${clean(item.link)}` : ''}`;
  } else {
    const at = item.file ? ` at ${clean(item.file)}${item.line ? `:${item.line}` : ''}` : '';
    const quoted = headOf(item.body, QUOTE_MAX).split('\n').map((l) => `> ${l}`).join('\n');
    text = `${clean(item.author)} commented on ${label}${at}:\n\n${quoted}\n\nAnswer it on this branch: change the code, or explain in your reply why not. Don't push, and don't reply on GitHub.${item.link ? `\n\nThe comment on GitHub: ${clean(item.link)}` : ''}`;
  }
  return extra ? `${String(extra).trim()}\n\n${text}` : text;
}

/** What the audit lines and the thread notes keep of an item: no log, no comment body. */
export function itemSummary(item) {
  return {
    key: item.key, kind: item.kind, pr: item.pr?.number ?? null, prLabel: item.pr?.label ?? null,
    ...(item.kind === 'check' ? { name: item.name, head: item.head ?? null } : { author: item.author, file: item.file ?? null, line: item.line ?? null }),
  };
}

// ---------- pr-feedback.json ----------

const fileOf = (featureDir) => path.join(featureDir, FEEDBACK_FILE);

/** The job's record: { items: { [key]: { state, at, item } } }. Missing or unreadable: none. */
export async function readFeedback(featureDir) {
  try {
    const data = JSON.parse(await fs.readFile(fileOf(featureDir), 'utf8'));
    return { items: data && typeof data.items === 'object' && !Array.isArray(data.items) ? data.items : {} };
  } catch { return { items: {} }; }
}

// One write at a time per file, each on top of the last.
const writing = new Map();

/** Set one item's state (and its item, when given, scrubbed of tokens). Written whole, through a temporary file. */
export function noteFeedback(featureDir, key, { state, item = null, at = new Date().toISOString() }) {
  const file = fileOf(featureDir);
  const next = (writing.get(file) ?? Promise.resolve()).then(async () => {
    const data = await readFeedback(featureDir);
    const was = data.items[key] ?? null;
    data.items[key] = { state, at, item: item ? scrubDeep(item) : was?.item ?? null };
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify({ version: 1, items: data.items }, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    return data.items[key];
  });
  const kept = next.catch(() => {});
  writing.set(file, kept);
  kept.then(() => { if (writing.get(file) === kept) writing.delete(file); });
  return next;
}
