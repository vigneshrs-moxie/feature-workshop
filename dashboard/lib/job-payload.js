// The new job page's payload (the job page rebuild, Task 1): everything the page draws, in one
// object, built from what the runner already knows about a job. Pure: no I/O, no git, no file
// reads, no clock. The cache (lib/job-payload-cache.js) calls it when a job changes, never on a
// request. Bodies (a reply's words, a brief, a document) are not in it: the page fetches each one
// by its id, and a line's `hash` says when a kept body is out of date.
//
// The payload (JobPagePayload; web/src/jobpage/types.ts mirrors it):
//
//   v            number: the cache's version of this payload
//   slug, title  string
//   key          'ORBIT-123' | null: the ticket (the ticket the job was started from, else the slug's)
//   keyUrl       string | null: the ticket in Orbit
//   kind         'feature' | 'bug'
//   state        'needs-you' | 'working' | 'waiting-github' | 'paused' | 'done' (stateOf)
//   lane         the snapshot lane (lib/snapshot.js LANES), as it is
//   laneReason   string | null: the lane's own sentence
//   stateLine    string: the one line shown when nothing waits for him
//   facts        { level: number | null, repo: string | null, branch: string | null, cost: number, model: string | null }
//   auto         the card's Auto with its tag and what it decided (runner jobDetail `auto`), or null
//   run          null | { id, status, startedAt, lastAction }: the job's newest run (Stop needs its id)
//   drive        { mode: 'none' | 'workshop' | 'running' | 'terminal' | 'terminal-open' }
//   lock         null | { owner, pid, branch, acquiredAt }: another process holds the job
//   local        { dir, worktree, policyOverride, started }: what the ⋯ menu's laptop items need (the job's
//                folder, its worktree, its own permission setting, whether its Foreman has a session)
//   heldReply    null | { kind, gateBrief, at }: a gate reply waiting for the usage limit
//   usage        null | { limited, resetsAt, label, line }: Claude's usage limit, and the gate's line about it
//   closed       null | { as: 'done' | 'dropped', at }
//   skipped      string[]: stages skipped
//   parked       boolean: the gate waited past the parking time
//   move         null | GateMove | QuestionMove | PermissionMove (below): what waits for him
//   asked        null (R5, Task 18)
//   steps        StepRow[]: the seven steps in order
//   rows         { conversation: { count }, decisions: { count } } (the page counts what is new itself;
//                the cache and mirrorJobPage add conversation.more: older items left out, the website's case)
//   open         { kind: ReaderKind, id }: what the reader shows on arrival (decision 2)
//   thread       ThreadLine[]: one line per conversation item, oldest first, no bodies
//   waiting      null (R8, Task 16: the one message waiting for the Foreman)
//   prs          PrLine[]: always three
//   hosted       boolean: built on the website (mirrorJobPage, which leaves out drive, lock and local: LOCAL_ONLY)
//
//   StepRow      { id: 'spec' | … | 'ship', label, state: 'done' | 'current' | 'todo' | 'skipped',
//                  word: string | null (the result: 'v3', '19 passed', '2 open', 'PR #1 open'; only on done
//                  and current steps), durationMs: number | null, startedAt: string | null, outputs: Output[]
//                  (what the left pane lists), main: { kind: ReaderKind, id } (what the reader shows when
//                  the step is opened; 'not-yet' for a step not started or skipped), more: Output[] (the
//                  step's other documents, for the reader only: lens rounds, review facts, second looks) }
//   Output       { kind: 'doc' | 'screens' | 'changes' | 'checks' | 'recording' | 'hand-test' | 'findings'
//                  | 'walkthrough' | 'pr', id (a doc's file, a PR's '1' | '2' | '3', else the kind), label,
//                  meta: string | null, version: string | null; a doc also gets `hash`, its text's hash,
//                  stamped by the cache (runner jobPageSource) }
//   ThreadLine   { id, kind: 'reply' | 'you' | 'brief' | 'problem' | 'small', at: string | null,
//                  step: StopId | null, headline, mine: boolean, hash (12 hex of the body),
//                  answered?: 'Go' | 'Send back' | 'Stop' | true | false (briefs), by?: 'auto' }
//   GateMove     { kind: 'gate', brief, ask, since, stage, nextStage, goSays,
//                  questions: [{ id, text, options: [{ id, label, consequence, recommended }] }],
//                  decided: number, openDecisions: string[] (id ?? decision of the unconfirmed ones,
//                  what Go confirms), stale, parked }
//   QuestionMove { kind: 'question', ask, since, quick: string[], itemId }
//   PermissionMove { kind: 'permission', id, card: 'permission' | 'question', what, command, questions,
//                  risk, since, canAllowForRun, hardLine, defaultToNo, canAlwaysAllow }
//   PrLine       { n: 1 | 2 | 3, number, url, state, word, next: null, comments: null }
//   ReaderKind   'message' | 'brief' | 'permission' | 'doc' | 'changes' | 'checks' | 'findings'
//                | 'walkthrough' | 'ship' | 'pr' | 'ticket' | 'conversation' | 'decisions' | 'details' | 'not-yet'

import { createHash } from 'node:crypto';
import { STAGE_STOP, STOPS, stopOf, stopStates } from './stage-view.js';
import { STAGES, detectStage } from './stages.js';
import { modelLabel } from './cost.js';
import { slugTicketKey } from './orbit.js';
import { EVIDENCE_JSON, WIREFRAMES_FILE, WIREFRAMES_JSON } from './docs.js';
import { cardPaused, jobWorking } from './working.js';

/**
 * What buildJobPage takes: what the runner already computed for the job (runner/index.js).
 * @typedef {object} JobFacts
 * @property {number} [v]               the payload's version (the cache's)
 * @property {object} card              boardCard(f, run): slug, title, kind, stage, stageState, skipped,
 *                                      needsYou, working, paused, limitPaused, restartPaused, waitingFor,
 *                                      waitingSince, permissions, level, repo, cost, auto, lock, closed,
 *                                      parked, wireframes, walkthrough
 * @property {string} [lane]            the snapshot lane (lib/snapshot.js laneFor)
 * @property {string|null} [laneReason] its sentence
 * @property {boolean} [lanePaused]     laneFor's `paused` (a usage-limit or restart pause)
 * @property {object} detail            parts of jobDetail(f): gate, permissionsPending, run, drive,
 *                                      heldReply, answeredBriefs, decidedOnYourBehalf, spec, auto,
 *                                      page { ticket, times, docs, checks, handTest, plan, review, prs }
 * @property {object[]} thread          buildThread(...) whole, before pageThread cuts it
 * @property {number|null} [commits]    the branch's own commits (branchCommitsOf(f).length), or null
 * @property {object|null} [evidence]   the evidence recording's view, when there is one
 * @property {object|null} [usage]      limits.view()
 * @property {string|null} [key]        the ticket key status.json names (statusTicketKey), when the runner read it
 * @property {string|null} [keyUrl]
 * @property {string|null} [orbitUrl]   Orbit's address, for the ticket's link
 * @property {boolean} [hosted]         built on the website
 */

const STATE_WORDS = { 'needs-you': 'Waiting for you', working: 'Working', 'waiting-github': 'Waiting on GitHub', paused: 'Paused', done: 'Done' };
const RESTING_LINE = 'Nothing is running. Send a message to carry on.';
// The run statuses that mean the Foreman is replying right now (runner ACTIVE_RUN).
const ACTIVE_RUN = new Set(['starting', 'running', 'waiting_permission', 'stopping']);
const liveRun = (run) => Boolean(run && ACTIVE_RUN.has(run.status));

/**
 * The job's one state word. Done (closed or the done lane) first, then needs-you (the snapshot's
 * lane; without a lane, a card, a gate or the record saying so), then a live reply is working; a
 * pause (usage limit, restart, a stopped reply) on a working lane that is not a recording, or with
 * no lane, is paused even while old crew rows still read as running; then the working lane, or with no lane the
 * card's working by the one rule (lib/working.js jobWorking: a paused job never works); in-review and ready wait on
 * GitHub; resting (and anything else) is paused.
 * @param {JobFacts} facts
 */
export function stateOf(facts) {
  const { card = {}, detail = {}, lane = null } = facts ?? {};
  if (card.closed || lane === 'done') return 'done';
  if (lane === 'needs-you') return 'needs-you';
  if (!lane && ((detail.permissionsPending ?? []).length || detail.gate || card.needsYou)) return 'needs-you';
  if (liveRun(detail.run)) return 'working';
  // A pause wins only over a working lane that is not a recording, or when there is no lane: card.paused
  // stays true after a stopped reply, while a PR waits on GitHub or the evidence is recorded.
  const pausable = lane === 'working' ? !card.testing : !lane;
  if (pausable && (facts?.lanePaused || cardPaused(card))) return 'paused';
  if (lane === 'working' || (!lane && jobWorking({ paused: cardPaused(card), working: card.working }))) return 'working';
  if (lane === 'in-review' || lane === 'ready') return 'waiting-github';
  return 'paused';
}

// ---------- Headlines ----------

const HEADLINE_MAX = 140;
const ANSWER_WORDS = { approve: 'Go', changes: 'Send back', stop: 'Stop' };
const DECIDING = new Set(Object.keys(ANSWER_WORDS));
const FENCE = /^\s*(`{3,}|~{3,})/;
// The gate card's next-step chips add these lines (lib/compose.js chipLine): a process choice, never an answer.
const OPTION_LINE = /^Option change for the next step:/;

/** The words cut at 140 characters at the end of a word, with …. */
function cut(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= HEADLINE_MAX) return t;
  const room = t.slice(0, HEADLINE_MAX - 1);
  // A word that ends right at the cut is kept whole.
  const space = t[HEADLINE_MAX - 1] === ' ' ? room.length : room.lastIndexOf(' ');
  return `${(space > HEADLINE_MAX / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

/** Inline markdown taken off: code marks, links and images to their words, bold and italic marks. */
function inline(text) {
  return String(text ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[\s(])[*_](\S[^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .trim();
}

/** A line without its block marks: quote, list bullet or number, heading. */
const unblock = (line) => line.replace(/^\s*(>\s*)*/, '').replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^#{1,6}\s+/, '');

/** The lines outside code blocks, each { text, heading }. */
function proseLines(md) {
  const out = [];
  let fence = null;
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const f = FENCE.exec(line)?.[1];
    if (f && !fence) { fence = f; continue; }
    if (f && fence && f[0] === fence[0] && f.length >= fence.length) { fence = null; continue; }
    if (fence) continue;
    out.push({ raw: line, heading: /^\s*#{1,6}\s/.test(line) });
  }
  return out;
}

/** The first sentence: up to the first . ! or ? followed by a space or the end, else all of it. */
function firstSentence(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?=\s|$)/.exec(t);
  return m ? m[1] : t;
}

/** The first paragraph's words (headings skipped while there is anything else). */
function firstParagraph(md) {
  const lines = proseLines(md);
  const para = [];
  for (const l of lines) {
    if (l.heading) { if (para.length) break; continue; }
    if (!l.raw.trim()) { if (para.length) break; continue; }
    para.push(inline(unblock(l.raw)));
  }
  if (para.length) return para.join(' ');
  const head = lines.find((l) => l.heading);
  return head ? inline(unblock(head.raw)) : '';
}

const SENTENCE_END = /[.!?](\s|$)/;
// A line that is only a bold run with no sentence end in it ("**Where we are**", "**Summary:**") stands as a heading.
function boldOnly(line) {
  const m = /^(\*\*|__)(.+?)\1\s*$/.exec(unblock(line).trim());
  return Boolean(m) && !SENTENCE_END.test(m[2]);
}

/**
 * A reply's headline from its first prose block (headings and bold-only lines skipped): a bold opener
 * that holds a sentence gives that sentence; anything else (a plain line, a bold label like
 * `**Status:** the build is done.`) gives the first sentence of the block, marks dropped. Bold further
 * down never counts. Only headings: the first one.
 */
function replyHeadline(md) {
  const lines = proseLines(md);
  const at = lines.findIndex((l) => !l.heading && l.raw.trim() && !boldOnly(l.raw));
  if (at < 0) return firstSentence(firstParagraph(md));
  const m = /^(\*\*|__)(.+?)\1/.exec(unblock(lines[at].raw).trim());
  if (m && SENTENCE_END.test(m[2])) return firstSentence(inline(m[2]));
  const para = [];
  for (const l of lines.slice(at)) {
    if (l.heading || !l.raw.trim()) break;
    para.push(inline(unblock(l.raw)));
  }
  return firstSentence(para.join(' '));
}

function stageLabel(stage) {
  const s = String(stage ?? '');
  const known = STAGES.find((x) => x.id === s) ?? STAGES.find((x) => x.id === detectStage(s));
  if (known) return known.label;
  const words = s.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Brief';
}

/**
 * One line's headline. A reply: its first bold sentence, else its first sentence. His message: its
 * first sentence. A brief: `Brief #15 · Review`, then `· answered: Go`, `· answered` or `· waiting`
 * by `answered` ('Go' | 'Send back' | 'Stop', true, false; left out: no answer part). A fold of
 * routine steps: what was allowed. Anything else: its first sentence. Cut at 140 characters on a word.
 */
export function headlineOf(item, { answered } = {}) {
  const it = item ?? {};
  switch (it.kind) {
    case 'reply':
      return cut(replyHeadline(it.reply ?? ''));
    case 'you': {
      const words = firstSentence(firstParagraph(it.text ?? ''));
      return cut(words || ANSWER_WORDS[it.sendKind] || 'Your message');
    }
    case 'brief': {
      const base = `Brief #${it.number ?? '?'} · ${stageLabel(it.stage)}`;
      if (answered === undefined) return base;
      if (answered === false) return `${base} · waiting`;
      return typeof answered === 'string' ? `${base} · answered: ${answered}` : `${base} · answered`;
    }
    case 'auto': {
      const items = Array.isArray(it.items) ? it.items : [];
      const first = items[0]?.headline ?? 'a routine step';
      return cut(`Allowed automatically: ${first}${items.length > 1 ? ` and ${items.length - 1} more` : ''}`);
    }
    default:
      return cut(firstSentence(inline(it.text ?? '')));
  }
}

// ---------- Thread lines ----------

const DETAIL_FILE = /^briefs\/(\d+)-(?:.+-)?detail\.md$/;
const isDetail = (it) => it?.kind === 'brief' && DETAIL_FILE.test(String(it.file ?? ''));
const briefStop = (stage) => {
  const s = String(stage ?? '');
  return stopOf(Object.hasOwn(STAGE_STOP, s) ? s : detectStage(s));
};
const hashOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

/** What a line's body is made of, for its hash: when this changes, a kept body is out of date. */
function bodyOf(it) {
  switch (it.kind) {
    case 'reply': return `reply|${it.stopped ? 1 : 0}|${it.reply ?? it.html ?? ''}`;
    case 'brief': return `brief|${it.file ?? ''}|${it.at ?? ''}|${it.headline ?? ''}|${it.point ?? ''}`;
    case 'auto': return `auto|${JSON.stringify(it.items ?? [])}`;
    case 'blocked': return `blocked|${it.text ?? ''}|${it.preview ?? ''}|${it.reason ?? ''}`;
    default: return `${it.kind}|${it.text ?? ''}`;
  }
}

/** Whether one of his later messages answers brief n (web/src/panes/Foreman/thread.ts youAnswers). */
function youAnswers(x, n, openBrief) {
  const lines = String(x.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => OPTION_LINE.test(l))) return false;
  if (x.gateBrief != null) return x.gateBrief === n && DECIDING.has(x.sendKind ?? '');
  if (n !== openBrief) return true;
  return DECIDING.has(x.sendKind ?? '');
}

/**
 * A brief's answer: the word of the gate reply sent for it (Go, Send back, Stop), else true when it
 * is answered another way (answeredBriefs, a newer brief, a later message of his), else false.
 */
function briefAnswer(items, i, answeredBriefs, openBrief) {
  const n = items[i].number;
  let word = null;
  for (const x of items) if (x.kind === 'you' && x.gateBrief === n && DECIDING.has(x.sendKind)) word = ANSWER_WORDS[x.sendKind];
  if (word) return word;
  const later = items.slice(i + 1);
  return answeredBriefs.has(n) || later.some((x) => (x.kind === 'brief' && !isDetail(x)) || (x.kind === 'you' && youAnswers(x, n, openBrief)));
}

const SMALL = new Set(['note', 'auto', 'decision', 'blocked']);
const lineKind = (kind) => (kind === 'reply' || kind === 'you' || kind === 'brief' || kind === 'problem' ? kind : 'small');
// What he did himself (thread.ts isYours): his messages (not Auto's), his permission answers, his notes saves.
const isMine = (it) => (it.kind === 'you' && it.by !== 'auto') || it.kind === 'decision' || (it.kind === 'note' && Boolean(it.notes));

/** The thread as lines: detail briefs folded into their brief; each line's step, headline, hash. */
function threadLines(thread, { answeredBriefs = [], openBrief = null } = {}) {
  const items = (Array.isArray(thread) ? thread : []).filter((it) => it && typeof it === 'object' && !isDetail(it));
  const answered = new Set(answeredBriefs ?? []);
  const briefs = items.filter((it) => it.kind === 'brief' && typeof it.at === 'string');
  // Times are buildThread's ISO times (UTC, `Z`), oldest first, so a string comparison orders them.
  const stepAt = (at) => {
    if (typeof at !== 'string') return null;
    let stop = null;
    for (const b of briefs) if (b.at <= at) stop = briefStop(b.stage) ?? stop;
    return stop;
  };
  return items.map((it, i) => {
    const kind = lineKind(SMALL.has(it.kind) ? 'small' : it.kind);
    const line = { id: String(it.id), kind, at: it.at ?? null, step: it.kind === 'brief' ? briefStop(it.stage) : stepAt(it.at), headline: '', mine: isMine(it), hash: hashOf(bodyOf(it)) };
    if (it.kind === 'brief') {
      line.answered = briefAnswer(items, i, answered, openBrief);
      line.headline = headlineOf(it, { answered: line.answered });
    } else {
      line.headline = headlineOf(it);
    }
    if (it.by === 'auto') line.by = 'auto';
    return line;
  });
}

// ---------- Steps ----------

const STEP_STATE = { done: 'done', now: 'current', waiting: 'current', next: 'todo', skipped: 'skipped' };
// Files with an output of their own: the screens, the recording.
const OWN_OUTPUT = new Set([WIREFRAMES_FILE, WIREFRAMES_JSON, EVIDENCE_JSON]);
const ROUND_FILE = /^(review|fable)\/(.+?)(?:-r(\d+))?\.md$/;
const PLAN_FILES = new Set(['implementation-plan.md', 'quick-plan.md', 'diagnosis.md']);
const many = (n, one, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

/** -1, 0 or 1: versions as the code writes them ('0.5', '3', '1.2.0'); none is lowest. */
function compareVersions(a, b) {
  if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1;
  const pa = String(a).split(/[.-]/).map(Number);
  const pb = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return String(a).localeCompare(String(b));
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * A step's documents, the latest of each: no briefs (they are in the conversation), nothing with an
 * output of its own; of a lens's review rounds (review/<lens>-r<N>.md) the highest round; of a file
 * listed more than once the highest version. In the order first seen.
 */
function latestDocs(list) {
  const kept = new Map(); // key -> { doc, rank }
  for (const d of Array.isArray(list) ? list : []) {
    const file = String(d?.file ?? '');
    if (!file || file.startsWith('briefs/') || OWN_OUTPUT.has(file)) continue;
    const m = ROUND_FILE.exec(file);
    const key = m ? `${m[1]}/${m[2]}` : file;
    const round = m ? Number(m[3] ?? 1) : 0;
    const was = kept.get(key);
    const newer = !was || round > was.round || (round === was.round && compareVersions(d.version ?? null, was.doc.version ?? null) >= 0);
    if (newer) kept.set(key, { doc: d, round });
  }
  return [...kept.values()].map(({ doc }) => doc);
}

const docOutput = (d, meta = null) => ({ kind: 'doc', id: String(d.file), label: String(d.name ?? d.file), meta, version: d.version == null ? null : String(d.version) });
const own = (kind, label, meta = null, version = null) => ({ kind, id: kind, label, meta, version });

function checksWords(checks) {
  if (!checks) return { word: null, meta: null };
  const passed = Number(checks.passed) || 0;
  const failed = Number(checks.failed) || 0;
  const notRun = Number(checks.notRun) || 0;
  const word = failed ? `${failed} failed` : passed || !notRun ? `${passed} passed` : `${notRun} not run`;
  return { word, meta: failed ? `${passed} passed · ${failed} failed` : word };
}

function findingsWord(review) {
  if (!review) return null;
  const open = (review.rows ?? []).filter((r) => r?.status === 'open').length;
  return open ? `${open} open` : 'nothing open';
}

/** A PR's state in a few words: `not open`, `open · checks passed · approved`, `merged`. */
function prWord(pr) {
  switch (pr?.state) {
    case 'open': return ['open', pr.checks ? `checks ${pr.checks}` : null, pr.review === 'approved' ? 'approved' : pr.review === 'changes' ? 'changes asked' : null].filter(Boolean).join(' · ');
    case 'draft': case 'merged': case 'closed': return pr.state;
    default: return 'not open';
  }
}

const docVersion = (docs, files) => (docs ?? []).find((d) => files.includes(d?.file) && d.version != null)?.version ?? null;

/** Each step's result word, outputs and main output (what the reader opens while it works). */
function stepParts(id, { facts, page, card, detail }) {
  const docs = latestDocs(page.docs?.[id]);
  switch (id) {
    case 'spec': {
      const v = detail.spec?.version ?? docVersion(page.docs?.spec, ['spec']);
      const outputs = docs.map((d) => docOutput(d));
      if (card.wireframes) outputs.push(own('screens', 'Screens', null, card.wireframes.version == null ? null : String(card.wireframes.version)));
      return { word: v != null ? `v${v}` : null, outputs };
    }
    case 'investigate': {
      const findings = docVersion(page.docs?.investigate, ['findings.md']);
      const repro = docVersion(page.docs?.investigate, ['repro.md']);
      return { word: findings != null ? `findings v${findings}` : repro != null ? `repro v${repro}` : null, outputs: docs.map((d) => docOutput(d)) };
    }
    case 'plan': {
      const v = page.plan?.version ?? docVersion(page.docs?.plan, [...PLAN_FILES]);
      const n = Array.isArray(page.plan?.steps) ? page.plan.steps.length : 0;
      return { word: v != null ? `v${v}` : null, outputs: docs.map((d) => docOutput(d, PLAN_FILES.has(d.file) && n ? many(n, 'step') : null)) };
    }
    case 'build': {
      const word = Number.isInteger(facts.commits) ? many(facts.commits, 'commit') : null;
      // Changes only (design brief): the plan is under Plan; the log and the plan are in `more`.
      return { word, outputs: [own('changes', 'Changes', word)], main: { kind: 'changes', id: 'changes' } };
    }
    case 'test': {
      const { word, meta } = checksWords(page.checks);
      const outputs = [];
      if (page.checks) outputs.push(own('checks', 'Checks', meta));
      if (facts.evidence) outputs.push(own('recording', 'Recording'));
      if (page.handTest) outputs.push(own('hand-test', 'Your hand test'));
      return { word, outputs: [...outputs, ...docs.map((d) => docOutput(d))], main: { kind: 'checks', id: 'checks' } };
    }
    case 'review': {
      const word = findingsWord(page.review);
      const outputs = [];
      if (page.review) outputs.push(own('findings', 'Findings', word));
      // Once the combined review exists it is the one document listed: the lenses' rounds, the
      // review facts and the Fable second looks are read from inside the reader (design brief:
      // "Findings, Review (combined), Walkthrough"). Before it, the latest round of each lens shows.
      const combined = docs.some((d) => d.file === 'review.md');
      outputs.push(...docs.filter((d) => !combined || !ROUND_FILE.test(String(d.file))).map((d) => docOutput(d)));
      if (card.walkthrough) outputs.push(own('walkthrough', 'Walkthrough'));
      return { word, outputs, main: page.review ? { kind: 'findings', id: 'findings' } : null };
    }
    case 'ship': {
      const prs = Array.isArray(page.prs) ? page.prs : [];
      const newest = [...prs].reverse().find((p) => p?.state && p.state !== 'not-started');
      return {
        word: newest ? `PR #${newest.n} ${newest.state}` : null,
        outputs: prs.map((p) => ({ kind: 'pr', id: String(p.n), label: `PR #${p.n}`, meta: prWord(p), version: null })),
        main: { kind: 'ship', id: 'ship' },
      };
    }
    default:
      return { word: null, outputs: docs.map((d) => docOutput(d)) };
  }
}

/**
 * What the step made that the left pane does not list, for the reader to reach (Tasks 12, 14: the
 * lenses' rounds, older ones too, the review facts, the Fable second looks, Build's plan and log):
 * every document of the step that is not a brief, has no output of its own, and is not listed; each
 * file once, at its highest version. In the order first seen.
 */
function moreDocs(list, outputs) {
  const listed = new Set(outputs.filter((o) => o.kind === 'doc').map((o) => o.id));
  const kept = new Map();
  for (const d of Array.isArray(list) ? list : []) {
    const file = String(d?.file ?? '');
    if (!file || file.startsWith('briefs/') || OWN_OUTPUT.has(file) || listed.has(file)) continue;
    const was = kept.get(file);
    if (!was || compareVersions(d.version ?? null, was.version ?? null) >= 0) kept.set(file, d);
  }
  return [...kept.values()].map((d) => docOutput(d));
}

function duration(span) {
  const a = Date.parse(span?.startedAt ?? '');
  const b = Date.parse(span?.endedAt ?? '');
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? b - a : null;
}

function buildSteps(ctx) {
  const { card, lane, page } = ctx;
  const states = stopStates({ stage: card.stage, stageState: card.stageState, skipped: card.skipped, kind: card.kind, needsYou: card.needsYou, lane, closed: card.closed });
  return STOPS.map((s) => {
    const state = STEP_STATE[states[s.id]] ?? 'todo';
    const parts = stepParts(s.id, ctx);
    const span = page.times?.[s.id] ?? null;
    const doc = parts.outputs.find((o) => o.kind === 'doc');
    // What the reader shows when the step is opened: a step not started (or skipped) has nothing yet.
    const main = state === 'todo' || state === 'skipped' ? { kind: 'not-yet', id: s.id }
      : parts.main ?? (doc ? { kind: 'doc', id: doc.id } : { kind: 'not-yet', id: s.id });
    return {
      row: {
        id: s.id, label: s.label, state,
        word: state === 'done' || state === 'current' ? parts.word : null,
        durationMs: duration(span), startedAt: span?.startedAt ?? null, outputs: parts.outputs,
        main, more: moreDocs(page.docs?.[s.id], parts.outputs),
      },
      main,
    };
  });
}

// ---------- What waits for him ----------

// What Go starts, by the stage it moves to (lib/gate.js nextStageAfter).
const GO_WORDS = {
  spec: 'write the spec', refine: 'refine the spec', wireframe: 'draw the screens', investigate: 'investigate the code',
  reproduce: 'reproduce the bug', 'spec-update': 'update the spec', plan: 'write the plan', diagnose: 'find the cause',
  implement: 'start the build', test: 'run the tests', review: 'start the review',
  pr1: 'open PR #1', pr2: 'open PR #2', 'staging-qa': 'check staging', pr3: 'open PR #3',
};

function gateMove(g) {
  const decided = Array.isArray(g.decided) ? g.decided : [];
  return {
    kind: 'gate',
    brief: g.briefNumber ?? null,
    ask: g.headline ?? (g.briefNumber != null ? `Brief #${g.briefNumber} waits for you` : 'The Foreman waits for you'),
    since: g.waitingSince ?? null,
    stage: g.stage ?? null,
    nextStage: g.nextStage ?? null,
    goSays: (g.nextStage && GO_WORDS[g.nextStage]) || 'carry on',
    questions: (g.questions ?? []).map((q) => {
      const options = Array.isArray(q.options) ? q.options : [];
      const rec = options.some((o) => o.id === q.recommendation) ? q.recommendation : null;
      return { id: String(q.id), text: q.text ?? '', options: options.map((o) => ({ id: String(o.id), label: o.label ?? '', consequence: o.consequence ?? null, recommended: rec !== null && o.id === rec })) };
    }),
    decided: decided.length,
    openDecisions: decided.filter((d) => !d?.confirmed).map((d) => d.id ?? d.decision),
    stale: Boolean(g.stale),
    parked: Boolean(g.parked),
  };
}

function permissionMove(p) {
  const qs = Array.isArray(p.input?.questions)
    ? p.input.questions.map((q) => ({ question: q?.question ?? '', options: (Array.isArray(q?.options) ? q.options : []).map((o) => ({ label: o?.label ?? '' })) }))
    : null;
  return {
    kind: 'permission', id: String(p.id), card: p.kind === 'question' ? 'question' : 'permission',
    what: p.plain?.headline ?? p.toolName ?? 'The crew wants to do something',
    command: typeof p.input?.command === 'string' ? p.input.command : null,
    questions: qs, risk: p.plain?.risk ?? null, since: p.createdAt ?? null,
    canAllowForRun: Boolean(p.canAllowForRun), hardLine: Boolean(p.hardLine), defaultToNo: Boolean(p.defaultToNo),
    canAlwaysAllow: Boolean(p.draft),
  };
}

const QUOTED = /"([^"\n]{1,80})"|“([^”\n]{1,80})”/g;
const REPLY_WORDS = /\b(reply|answer|say|type|write|send)\b/i;

/** The replies the Foreman names in quotes on a line that says to reply ("reply like "smoke ok""), at most four. */
function quickReplies(md) {
  const out = [];
  for (const { raw } of proseLines(md)) {
    if (!REPLY_WORDS.test(raw)) continue;
    for (const m of raw.matchAll(QUOTED)) {
      const q = (m[1] ?? m[2]).trim();
      if (q && !out.includes(q)) out.push(q);
    }
  }
  return out.slice(0, 4);
}

function questionMove(thread, card) {
  const reply = [...(Array.isArray(thread) ? thread : [])].reverse().find((it) => it?.kind === 'reply');
  if (!reply) return null;
  return { kind: 'question', ask: headlineOf(reply), since: card.waitingSince ?? reply.at ?? null, quick: quickReplies(reply.reply ?? ''), itemId: String(reply.id) };
}

function moveOf({ card, detail, thread }) {
  const pending = Array.isArray(detail.permissionsPending) ? detail.permissionsPending : [];
  if (pending.length) return permissionMove(pending[0]);
  if (detail.gate) return gateMove(detail.gate);
  if (card.needsYou) return questionMove(thread, card);
  return null;
}

/** What the reader shows on arrival (decision 2). */
function openOf(state, move, steps) {
  const conversation = { kind: 'conversation', id: 'conversation' };
  if (state === 'needs-you') {
    if (move?.kind === 'permission') return { kind: 'permission', id: move.id };
    if (move?.kind === 'gate' && move.briefFile) return { kind: 'brief', id: `brief:${move.briefFile}` };
    if (move?.kind === 'question') return { kind: 'message', id: move.itemId };
    return conversation;
  }
  if (state === 'working') {
    const main = steps.find((s) => s.row.state === 'current')?.main;
    return main && main.kind !== 'not-yet' ? main : conversation;
  }
  return conversation;
}

// ---------- The payload ----------

const pick = (o, keys) => (o ? Object.fromEntries(keys.map((k) => [k, o[k] ?? null])) : null);

/**
 * The page's payload for one job (the shape is at the top of this file). Pure.
 * @param {JobFacts} facts
 */
export function buildJobPage(facts) {
  const f = facts ?? {};
  const card = f.card ?? {};
  const detail = f.detail ?? {};
  const page = detail.page ?? {};
  const lane = f.lane ?? null;
  const state = stateOf(f);
  const laneReason = f.laneReason ?? null;
  const stateLine = lane === 'resting' ? RESTING_LINE : laneReason || STATE_WORDS[state];

  const slug = String(card.slug ?? '');
  const key = f.key ?? page.ticket?.key ?? slugTicketKey(slug);
  const keyUrl = f.keyUrl ?? page.ticket?.url ?? (key && f.orbitUrl ? `${f.orbitUrl}/admin/feedback/${key}` : null);

  const steps = buildSteps({ facts: f, page, card, detail, lane });
  const gate = detail.gate ?? null;
  const move = moveOf({ card, detail, thread: f.thread });
  const open = openOf(state, move?.kind === 'gate' ? { ...move, briefFile: gate?.briefFile ?? null } : move, steps);
  const thread = threadLines(f.thread, { answeredBriefs: detail.answeredBriefs, openBrief: gate?.briefNumber ?? null });

  const usageLine = gate?.usage ?? null;
  const usage = f.usage || usageLine
    ? { limited: Boolean(f.usage?.limited), resetsAt: f.usage?.resetsAt ?? null, label: f.usage?.label ?? null, line: usageLine }
    : null;
  const decided = (detail.decidedOnYourBehalf ?? []).length + (Array.isArray(detail.auto?.decided) ? detail.auto.decided.length : 0);
  const model = detail.drive?.model ? modelLabel(detail.drive.model) : null;

  return {
    v: Number.isInteger(f.v) ? f.v : 0,
    slug, key: key ?? null, keyUrl: keyUrl ?? null, title: String(card.title ?? slug),
    kind: card.kind === 'bug' ? 'bug' : 'feature',
    state, lane, laneReason, stateLine,
    facts: {
      level: Number.isInteger(card.level) ? card.level : null,
      repo: card.repo?.name ?? null,
      branch: card.repo && !card.repo.branchGuessed ? card.repo.branch ?? null : null,
      cost: Number(card.cost?.totalUsd) || 0,
      model,
    },
    auto: detail.auto ?? card.auto ?? null,
    run: pick(detail.run, ['id', 'status', 'startedAt', 'lastAction']),
    drive: { mode: detail.drive?.mode ?? 'none' },
    lock: card.lock ?? null,
    local: {
      dir: typeof detail.dir === 'string' ? detail.dir : null,
      worktree: typeof detail.worktree === 'string' ? detail.worktree : null,
      policyOverride: typeof detail.policyOverride === 'string' ? detail.policyOverride : null,
      started: Boolean(detail.drive?.sessionId),
    },
    heldReply: detail.heldReply ?? null,
    usage,
    closed: card.closed ?? null,
    skipped: Array.isArray(card.skipped) ? card.skipped : [],
    parked: Boolean(card.parked),
    move,
    asked: null,
    steps: steps.map((s) => s.row),
    rows: { conversation: { count: thread.length }, decisions: { count: decided } },
    open,
    thread,
    waiting: null,
    prs: (Array.isArray(page.prs) ? page.prs : []).map((p) => ({ n: p.n, number: p.number ?? null, url: p.url ?? null, state: p.state ?? 'not-started', word: prWord(p), next: null, comments: null })),
    hosted: Boolean(f.hosted),
  };
}

// ---------- The website's payload ----------

/** What only the laptop has: how the job is driven (terminals), which process holds it, and what the ⋯ menu's laptop items need. Left out on the website. */
export const LOCAL_ONLY = Object.freeze(['drive', 'lock', 'local']);

/**
 * The website's payload (hosted/site/routes-mirror.js), the same shape built from the mirrored job
 * record (runner/mirror.js jobRecord: jobDetail's shape, the Foreman's replies already lines saying
 * they show on the laptop, the newest 60 items): hosted, and without the LOCAL_ONLY fields. `row` is
 * the job's row on the mirrored board (its lane); `v` the record's version (the site's own).
 * @param {object} job  the mirrored job record
 * @param {{ row?: object | null, v?: number }} [o]
 */
export function mirrorJobPage(job, { row = null, v = 0 } = {}) {
  const j = job ?? {};
  const payload = buildJobPage({
    v, card: j, detail: j, thread: Array.isArray(j.thread) ? j.thread : [],
    lane: row?.lane ?? j.lane ?? null, laneReason: row?.laneReason ?? j.laneReason ?? null, lanePaused: Boolean(row?.paused),
    commits: null, evidence: null, usage: null, hosted: true,
  });
  for (const k of LOCAL_ONLY) delete payload[k];
  // The same extras the laptop's cache stamps: a document's text hash (not on the record: null here), and
  // whether older conversation is left out (the record keeps the newest 60; the rest show on the laptop).
  for (const st of payload.steps) for (const o of [...st.outputs, ...st.more]) if (o.kind === 'doc') o.hash = null;
  payload.rows.conversation.more = Boolean(j.threadMore);
  return payload;
}
