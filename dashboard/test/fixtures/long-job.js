// A made-up long job for the new job page's tests, its speed checks and the demo (the job page
// rebuild, Task 2). Shaped like a real long job: 52 conversation items (16 Foreman replies with a
// median of 450 words and one of 800, 16 of his messages, 15 briefs, 5 small notes), seven steps,
// 22 review files of which the latest of each kind shows, 2 findings, 9 commits over 14 files, one
// recording and three PRs. A second one is four times as long (200 items) for the speed checks.
//
// Every word is invented, and the same every run: the text comes from a seeded generator, the
// times from a fixed start (the demo passes its own). The conversation is made the way the runner
// makes it: audit lines and briefs through lib/thread.js buildThread; the step facts through the
// same pure helpers the runner calls (stepTimes, stepDocs, reviewRows, checkCounts, prRows).
//
//   longJobSource({ size, start })  the job's raw parts: briefs (with their text), audit lines,
//                                   documents (with their text), commits, the gate, the evidence
//   longJobFacts({ size, start })   `facts` as lib/job-payload.js buildJobPage takes them
//   longJobPage({ size, start })    { counts, facts, payload, bodies, commits }: the payload and
//                                   the bodies the page fetches by id ({ id, kind, html, text, meta })
//   LONG_JOB_COUNTS                 every count above, for both sizes (the tests rely on them)
//   wordCount(text)                 how the fixture counts a reply's words

import { buildThread } from '../../lib/thread.js';
import { parseBrief } from '../../lib/overview.js';
import { describeDoc, DOC_GROUPS, EVIDENCE_JSON, WIREFRAMES_FILE } from '../../lib/docs.js';
import { checkCounts, planSteps, prRows, readAcceptance, stepDocs, stepStates, stepTimes } from '../../lib/job-page.js';
import { reviewRows } from '../../lib/play.js';
import { EVIDENCE_VERSION } from '../../lib/evidence.js';
import { buildJobPage } from '../../lib/job-payload.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { checksSource, findingsSource } from '../../lib/job-payload-cache.js';

export const SIZES = [52, 200];

/** Every count of the two jobs. The 200-item job is four times the 52-item one where a count scales. */
export const LONG_JOB_COUNTS = Object.freeze({
  52: Object.freeze({
    items: 52, replies: 16, you: 16, briefs: 15, small: 5, steps: 7,
    reviewFiles: 22, reviewShown: 1, findings: 2, findingsOpen: 1, commits: 9, commitFiles: 14,
    recordings: 1, prs: 3, replyMedianWords: 450, replyMaxWords: 800, longestReplies: 1,
    checks: 14, decisions: 13, planSteps: 5,
  }),
  // 200 items, as the plan asks: briefs and notes four times over (60, 20), replies and his messages
  // 60 each (four times 16 would make 208).
  200: Object.freeze({
    items: 200, replies: 60, you: 60, briefs: 60, small: 20, steps: 7,
    reviewFiles: 88, reviewShown: 1, findings: 8, findingsOpen: 4, commits: 36, commitFiles: 56,
    recordings: 1, prs: 3, replyMedianWords: 450, replyMaxWords: 800, longestReplies: 4,
    checks: 56, decisions: 52, planSteps: 20,
  }),
});

export const LONG_JOB = Object.freeze({
  52: Object.freeze({ slug: 'orbit-905-crew-schedule-export', title: 'Crew schedule export', branch: 'feature/crew-schedule-export' }),
  200: Object.freeze({ slug: 'orbit-906-crew-schedule-export-long', title: 'Crew schedule export (long)', branch: 'feature/crew-schedule-export-long' }),
});

/** Where the fixed times start (UTC). */
export const LONG_JOB_START = '2026-11-02T15:00:00.000Z';

const MIN = 60_000;
const at = (ms) => new Date(ms).toISOString();

/** A reply's words: whitespace-separated pieces with a letter in them (markdown marks alone don't count). */
export function wordCount(text) {
  return String(text ?? '').split(/\s+/).filter((t) => /\p{L}/u.test(t)).length;
}

// ---------- Seeded words ----------

/** mulberry32: a small seeded generator, so every run writes the same words. */
function seeded(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  return { next, int, pick };
}

const SUBJECTS = [
  'The export', 'The schedule page', 'The CSV file', 'The week picker', 'The crew list', 'The download button',
  'The time zone check', 'The new test', 'The office filter', 'The row limit', 'The header row', 'The empty week',
  'The shift table', 'The file name', 'The totals line', 'The night shift rule', 'The crew lead column',
  'The holiday marker', 'The sort order', 'The notes column', 'The loading message', 'The error banner',
];
const VERBS = [
  'now writes', 'keeps', 'skips', 'checks', 'sorts', 'groups', 'reads', 'rounds', 'shows', 'names', 'counts',
  'leaves out', 'puts first', 'repeats', 'adds', 'trims', 'splits', 'joins', 'marks', 'waits for',
];
const OBJECTS = [
  'one row per shift', 'the crew lead first', 'shifts that cross midnight', 'the office time zone',
  'the week in the file name', 'blank notes as empty cells', 'the total hours at the bottom',
  'every crew in the office', 'the start and end of each shift', 'the holiday rows', 'quotes inside a note',
  'the first day of the week', 'crews with no shifts', 'the columns in screen order', 'the date as year, month and day',
  'a second office', 'the van number', 'split shifts', 'the overtime hours', 'a cancelled shift',
];
const TAILS = [
  'before it saves the file', 'on every page of the week', 'for each office on its own', 'when the week is empty',
  'as the spec asks', 'in the same order as the screen', 'without a page reload', 'for the office manager only',
  'the way the printout does', 'even for a long week', 'while the table loads', 'after the last crew',
  'with the same rounding as payroll', 'so nothing is counted twice', 'and the tests cover it',
];
const HEADINGS = [
  'Where things stand', 'What changed', 'What I checked', 'Open points', 'What is next', 'How it reads now',
  'The rows', 'The file name', 'Time zones', 'The tests', 'What I left alone', 'Before the PR',
];
// Short closing sentences by length, so a text can end on an exact word count.
const CLOSERS = ['', 'Done.', 'All done.', 'Nothing else changed.', 'The rest stays put.', 'Tell me if that works.', 'I can change it if needed.', 'Say the word and I carry on.'];

function sentenceWords(r) {
  return `${r.pick(SUBJECTS)} ${r.pick(VERBS)} ${r.pick(OBJECTS)} ${r.pick(TAILS)}`.split(' ');
}

/** The first k words of a sentence, no full stop: a short label. */
const phrase = (r, k) => sentenceWords(r).slice(0, k).join(' ');

/** Sentences with exactly n words in all (n >= 0). */
function sentences(r, n) {
  const out = [];
  let left = n;
  while (left > 0) {
    if (left < CLOSERS.length) { out.push(CLOSERS[left]); break; }
    let words = sentenceWords(r);
    // Too long: the sentence without its tail, else its first words.
    if (words.length > left) words = `${r.pick(SUBJECTS)} ${r.pick(VERBS)} ${r.pick(OBJECTS)}`.split(' ');
    if (words.length > left) words = words.slice(0, left);
    out.push(`${words.join(' ')}.`);
    left -= words.length;
  }
  return out;
}

/** A Foreman reply of exactly n words: a bold first sentence, paragraphs, a heading or two, a list. */
function replyText(r, n) {
  const blocks = [];
  let left = n;
  const take = (k) => { const w = Math.min(k, left); left -= w; return w; };
  const first = sentenceWords(r);
  const firstN = take(first.length);
  blocks.push(`**${first.slice(0, firstN).join(' ')}.** ${sentences(r, take(r.int(18, 30))).join(' ')}`.trim());
  let i = 0;
  while (left > 0) {
    const kind = i % 4;
    i += 1;
    if (kind === 1 && left > 40) {
      const h = r.pick(HEADINGS);
      const hw = take(h.split(' ').length);
      blocks.push(`## ${h.split(' ').slice(0, hw).join(' ')}`);
    } else if (kind === 3 && left > 30) {
      const items = [];
      for (let k = 0; k < 3 && left > 0; k++) items.push(`- ${sentences(r, take(r.int(8, 13))).join(' ')}`);
      blocks.push(items.join('\n'));
    } else {
      blocks.push(sentences(r, take(r.int(30, 60))).join(' '));
    }
  }
  return blocks.filter(Boolean).join('\n\n');
}

const OPENERS = {
  approve: ['Go ahead.', 'Looks right, go on.', 'Yes, carry on.', 'Good, keep going.'],
  changes: ['Not yet.', 'Close, but not quite.', 'Hold on, one change first.'],
  message: ['One more thing first.', 'A question before you go on.', 'Quick note from the office.'],
  feature: ['The office managers want the crew schedule as a file.'],
};

/** One of his messages, about n words, starting with what it is. */
function youText(r, n, kind) {
  const open = r.pick(OPENERS[kind] ?? OPENERS.message);
  return [open, ...sentences(r, Math.max(0, n - wordCount(open)))].join(' ');
}

const STAGE_WORDS = { spec: 'spec', wireframe: 'screens', investigate: 'investigation', plan: 'plan', implement: 'build', test: 'checks', review: 'review' };

function briefText(r, { title, stage, round, decisions = [] }) {
  const happened = [0, 1, 2].map(() => `- ${sentences(r, r.int(12, 20)).join(' ')}`);
  const concerns = [`- ${sentences(r, r.int(10, 18)).join(' ')}`];
  const asks = decisions.length
    ? decisions.map((d, i) => `${i + 1}. ${d.text} Recommended: ${d.options.find((o) => o.id === d.recommendation)?.label}.`)
    : [`1. ${sentences(r, r.int(8, 12)).join(' ')} Recommended: yes.`];
  return [
    `**${title} · ${STAGE_WORDS[stage] ?? stage} ${round} is ready: ${phrase(r, r.int(5, 7)).toLowerCase()}**`,
    '', '**What happened**', ...happened,
    '', '**Concerns**', ...concerns,
    '', '**Decisions for you**', ...asks,
    '', `**Next:** ${sentences(r, r.int(8, 12)).join(' ')}`, '',
  ].join('\n');
}

// ---------- Shapes that scale ----------

const STAGE_RUNS = [['spec', 1], ['wireframe', 1], ['investigate', 1], ['plan', 2], ['implement', 2], ['test', 4], ['review', 4]];
const LENSES = ['spec', 'tests', 'conventions', 'errors', 'permissions', 'db', 'performance', 'ui', 'facts'];
const LENS_COLUMN = { spec: 'spec', tests: 'tests', conventions: 'conventions', errors: 'errors', permissions: 'permissions', db: 'db', performance: 'performance', ui: 'ui', facts: 'spec' };
const FOLDERS = ['app/schedule', 'app/export', 'app/crews', 'app/offices', 'test/schedule', 'test/export', 'app/shared'];
const NAMES = ['csv', 'week', 'rows', 'header', 'timezone', 'filename', 'limits', 'totals', 'notes', 'sort'];

/** Reply lengths: half under 450, half over, the middle two 440 and 460 (median 450), the longest 800. */
function replyLengths(r, count, longest) {
  const half = count / 2;
  const low = Array.from({ length: half }, (_, i) => Math.round(250 + (190 * i) / Math.max(1, half - 1)));
  const high = Array.from({ length: half }, (_, i) => Math.round(460 + (180 * i) / Math.max(1, half - 1)));
  for (let k = 0; k < longest; k++) high[half - 1 - k] = 800;
  const all = [...low, ...high];
  // A fixed shuffle, so the long ones sit through the job, not at its end.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

const pad = (n) => String(n).padStart(3, '0');

// ---------- The source ----------

/**
 * The job's raw parts, as the runner would find them on disk and in the audit log: everything
 * else (the facts, the payload, the demo's files) is made from this.
 * @param {{ size?: 52 | 200, start?: string }} [o]
 */
export function longJobSource({ size = 52, start = LONG_JOB_START } = {}) {
  const counts = LONG_JOB_COUNTS[size];
  if (!counts) throw new Error(`No long job of ${size} items (try ${SIZES.join(' or ')}).`);
  const { slug, title, branch } = LONG_JOB[size];
  const scale = size === 52 ? 1 : 4;
  const r = seeded(size * 7919 + 17);
  let t = Date.parse(start);
  const tick = (lo, hi) => { t += r.int(lo, hi) * MIN; return at(t); };

  // Stages of the briefs, in order.
  const stages = STAGE_RUNS.flatMap(([stage, n]) => Array.from({ length: n * scale }, () => stage));
  const rounds = {};
  const lengths = replyLengths(r, counts.replies, counts.longestReplies);
  const youLeft = { n: counts.you };
  // Which briefs he sent back (the rest he said Go to); the last brief is the open gate.
  const sentBack = new Set(stages.map((_, i) => i + 1).filter((n) => n % 5 === 4));
  const lastBrief = stages.length;

  // The open gate's questions and the decisions made for him (status.json's words).
  const questions = [
    { id: '1', text: 'Open PR #1 now, or try the export on a copy of last week first?', recommendation: 'a', options: [{ id: 'a', label: 'Open PR #1 now', consequence: 'The org branch has it today' }, { id: 'b', label: 'Try last week first', consequence: 'About half a day later' }] },
    { id: '2', text: 'Keep the commits as they are, or squash them into one?', recommendation: 'a', options: [{ id: 'a', label: 'Keep them', consequence: null }, { id: 'b', label: 'Squash into one', consequence: 'One commit to read' }] },
  ];
  const decided = Array.from({ length: counts.decisions }, (_, i) => ({
    id: `D-${pad(i + 1)}`,
    decision: phrase(r, r.int(6, 10)),
    reason: phrase(r, r.int(6, 9)).toLowerCase(),
    where: i < counts.decisions / 2 ? 'spec v0.4' : 'plan v2',
    confirmed: i < counts.decisions - 2,
  }));

  const briefs = [];
  const audit = [];
  const firstAt = at(t);
  audit.push({ at: firstAt, action: 'send', kind: 'feature', text: youText(r, 160, 'feature') });
  youLeft.n -= 1;
  let replyIndex = 0;
  let smallIndex = 0;
  // Small notes after these replies: spread through the job.
  const smallAfter = new Set(Array.from({ length: counts.small }, (_, i) => Math.floor(((i + 0.5) * counts.replies) / counts.small)));
  const smallKinds = [
    () => ({ action: 'permission', decision: 'allow', tool: 'Bash', headline: 'Run the export unit tests' }),
    () => ({ action: 'notes' }),
    () => ({ action: 'job-policy', policy: 'hands-off' }),
    () => ({ action: 'notes' }),
    () => ({ action: 'job-policy', policy: null }),
  ];
  const reply = () => {
    const text = replyText(r, lengths[replyIndex]);
    audit.push({ at: tick(2, 6), action: 'run-ended', status: 'done', reply: text });
    if (smallAfter.has(replyIndex)) audit.push({ at: tick(3, 9), ...smallKinds[smallIndex++ % smallKinds.length]() });
    replyIndex += 1;
  };

  stages.forEach((stage, i) => {
    const number = i + 1;
    rounds[stage] = (rounds[stage] ?? 0) + 1;
    const file = `briefs/${pad(number)}-${stage}.md`;
    const isGate = number === lastBrief;
    const text = briefText(r, { title, stage, round: rounds[stage], decisions: isGate ? questions : [] });
    briefs.push({ number, stage, file, at: tick(50, 170), text });
    reply();
    if (youLeft.n > 0) {
      const kind = isGate ? 'message' : sentBack.has(number) ? 'changes' : 'approve';
      const entry = { at: tick(20, 90), action: 'send', kind, text: youText(r, r.int(30, 170), kind) };
      if (kind !== 'message') entry.gateBrief = number;
      audit.push(entry);
      youLeft.n -= 1;
    }
  });
  while (replyIndex < counts.replies) reply();
  const endAt = at(t);

  // The gate stays open on the last brief.
  const gateBrief = briefs.at(-1);
  const gate = {
    briefNumber: gateBrief.number, briefFile: gateBrief.file, headline: parseBrief(gateBrief.text).headline,
    stage: 'review', nextStage: 'pr1', nextProposed: 'Open PR #1', questions, decided,
    versions: null, raisedVersions: null, stale: false, waitingSince: gateBrief.at, runActive: false, parked: false,
    level: 3, usage: null, proof: null,
  };

  // ---------- Documents ----------
  const briefAt = (stage) => briefs.filter((b) => b.stage === stage).at(-1)?.at ?? firstAt;
  const docText = [];
  const doc = (file, text, version, when) => docText.push({ file, text, version: version == null ? null : String(version), updatedAt: when });
  const para = (k = 3) => Array.from({ length: k }, () => sentences(r, r.int(30, 55)).join(' ')).join('\n\n');

  const planIds = Array.from({ length: counts.planSteps }, (_, i) => `S${i + 1}`);
  const acIds = Array.from({ length: counts.checks }, (_, i) => `AC-${i + 1}`);
  const specText = `# Product spec v0.4: ${title}\n\n## Key points\n\n${[0, 1, 2].map(() => `- ${sentences(r, r.int(10, 16)).join(' ')}`).join('\n')}\n\n## What it does\n\n${para(3)}\n`;
  doc('spec', specText, '0.4', briefAt('spec'));
  doc('spec.md', specText, null, briefAt('spec'));
  doc('findings.md', `# Findings v1: ${title}\n\n${para(4)}\n`, '1', briefAt('investigate'));
  const planText = `# Implementation plan v2: ${title}\n\n${para(1)}\n\n${planIds.map((id) => `### ${id}: ${phrase(r, 6)}\n\n${sentences(r, r.int(25, 40)).join(' ')}\n`).join('\n')}`;
  doc('implementation-plan.md', planText, '2', briefAt('plan'));
  doc('test-plan.md', `# Test plan v2: ${title}\n\n${para(2)}\n\n${acIds.map((id) => `- ${id}: ${sentences(r, r.int(8, 12)).join(' ')}`).join('\n')}\n`, '2', briefAt('plan'));
  const acceptText = `# Acceptance v3: ${title}\n\n## It works when\n\n${acIds.map((id, i) => `${i + 1}. ${id}: ${sentences(r, r.int(8, 12)).join(' ')}`).join('\n')}\n\n## It must not\n\n1. ${sentences(r, 10).join(' ')}\n`;
  doc('acceptance.md', acceptText, '3', briefAt('plan'));
  doc('implementation-log.md', `# Implementation log v2: ${title}\n\n${planIds.map((id) => `## ${id}\n\n${sentences(r, r.int(20, 35)).join(' ')}\n`).join('\n')}`, '2', briefAt('implement'));
  const reportText = `# Test report v4: ${title}\n\n${para(1)}\n\n${acIds.map((id) => `- ${id}: PASS. ${sentences(r, r.int(6, 10)).join(' ')}`).join('\n')}\n`;
  doc('test-report.md', reportText, '4', briefAt('test'));

  // The review: its combined document with the findings table, the lens rounds, the second looks.
  const findingRows = Array.from({ length: counts.findings }, (_, i) => ({
    severity: 'Major', lens: LENS_COLUMN[LENSES[i % LENSES.length]],
    text: sentences(r, r.int(14, 22)).join(' '), status: i % 2 === 0 ? 'Fixed' : 'Open',
  }));
  const reviewText = [
    `# Review v2: ${title}`, '', para(1), '', '## Round 2', '',
    '| # | Severity | Lens | Finding | Status |', '|---|---|---|---|---|',
    ...findingRows.map((f, i) => `| R-${i + 1} | ${f.severity} | ${f.lens} | ${f.text} | ${f.status} |`), '',
  ].join('\n');
  doc('review.md', reviewText, '2', briefAt('review'));
  const reviewBriefs = briefs.filter((b) => b.stage === 'review').length;
  const fables = 2 * scale;
  const lensFiles = counts.reviewFiles - reviewBriefs - 1 - fables;
  for (let i = 0; i < lensFiles; i++) {
    const lens = LENSES[i % LENSES.length];
    const round = Math.floor(i / LENSES.length) + 1;
    const file = round === 1 ? `review/${lens}.md` : `review/${lens}-r${round}.md`;
    doc(file, `# Review: ${lens} (round ${round})\n\n${para(2)}\n`, null, briefAt('review'));
  }
  for (let i = 0; i < fables; i++) {
    const stage = i % 2 === 0 ? 'plan' : 'review';
    doc(`fable/${pad(i + 1)}-${stage}.md`, `# Second look ${i + 1}: the ${stage}\n\n${para(2)}\n`, String(i + 1), briefAt(stage));
  }
  doc('workflow-status.md', `# ${title}: workflow status\n\n## Current stage\n\nReview, waiting for the go-ahead.\n\n## Next\n\nOpen PR #1.\n`, null, endAt);
  for (const b of briefs) doc(b.file, b.text, null, b.at);

  // ---------- Commits and the recording ----------
  const files = [];
  for (let k = 0; files.length < counts.commitFiles; k++) {
    const folder = FOLDERS[k % FOLDERS.length];
    const name = NAMES[Math.floor(k / FOLDERS.length) % NAMES.length];
    const round = Math.floor(k / (FOLDERS.length * NAMES.length));
    files.push(`${folder}/${name}${round ? `-${round + 1}` : ''}.${folder.startsWith('test') ? 'test.ts' : 'ts'}`);
  }
  const buildStart = Date.parse(briefs.find((b) => b.stage === 'implement')?.at ?? firstAt);
  const commits = Array.from({ length: counts.commits }, (_, i) => {
    const step = planIds[Math.floor((i * planIds.length) / counts.commits)];
    // Each file once (round robin, where it is new), and the previous commit's first file again.
    const own = files.filter((_, k) => k % counts.commits === i);
    const again = i > 0 ? [files[i - 1]] : [];
    const paths = [...new Set([...own, ...again])];
    const sha = hex(`${slug}|${i}`);
    return {
      sha, short: sha.slice(0, 8), author: 'Crew builder', date: at(buildStart + (i + 1) * 17 * MIN),
      subject: `feat(schedule): ${phrase(r, 6).toLowerCase()} [${step}]`, step,
      files: paths.map((p, k) => ({ path: p, added: r.int(4, 90), removed: k === 0 ? 0 : r.int(0, 20), isNew: own.includes(p) })),
    };
  });
  const evidence = {
    version: EVIDENCE_VERSION, commit: commits.at(-1).short, at: briefAt('test'), level: 3,
    criteria: acIds.map((id) => ({ id, title: phrase(r, r.int(5, 8)), status: 'passed', reason: null, spec: null, screenshots: [], video: null })),
  };
  doc(EVIDENCE_JSON, `${JSON.stringify(evidence, null, 2)}\n`, null, briefAt('test'));

  return {
    size, slug, title, branch, counts, start, firstAt, endAt,
    briefs, audit, gate, decided, questions, docs: docText, commits, evidence,
    wireframes: { version: '1', updatedAt: briefAt('wireframe'), size: 18_400 },
    planText, reviewText, reportText, specText, acceptText,
  };
}

/** 40 hex characters from a string: a stable made-up commit id. */
function hex(s) {
  let h1 = 0x811c9dc5;
  let out = '';
  for (let round = 0; out.length < 40; round++) {
    for (const ch of `${s}#${round}`) h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
    out += h1.toString(16).padStart(8, '0');
  }
  return out.slice(0, 40);
}

// ---------- Facts ----------

/** The documents as lib/docs.js listJobDocs lists them: describeDoc's names and groups, its order. */
function listedDocs(src) {
  const list = src.docs.map((d) => {
    const size = Buffer.byteLength(d.text);
    if (d.file === 'spec') return { file: 'spec', name: 'Product spec', group: 'plan', order: -1, version: d.version, updatedAt: d.updatedAt, size, type: 'md' };
    return { file: d.file, size, updatedAt: d.updatedAt, ...describeDoc(d.file), version: d.version, type: d.file.endsWith('.json') ? 'json' : 'md' };
  });
  list.push({ file: WIREFRAMES_FILE, ...describeDoc(WIREFRAMES_FILE), version: src.wireframes.version, updatedAt: src.wireframes.updatedAt, size: src.wireframes.size, type: 'html' });
  list.sort((a, b) => DOC_GROUPS.indexOf(a.group) - DOC_GROUPS.indexOf(b.group) || a.order - b.order || a.name.localeCompare(b.name));
  return list.map(({ order, ...d }) => ({ ...d, summary: null }));
}

/** The thread as the runner builds it (lib/thread.js), before the page cuts it. */
function threadOf(src) {
  const briefs = src.briefs.map((b) => {
    const parsed = parseBrief(b.text);
    return { number: b.number, stage: b.stage, file: b.file, at: b.at, headline: parsed.headline, point: parsed.happened[0] ?? parsed.next ?? null, versions: null };
  });
  return buildThread({ briefs, audit: src.audit, autoResume: true, service: [], featureDir: null });
}

/**
 * `facts` for lib/job-payload.js buildJobPage: the job at Review, the gate open on its last brief,
 * nothing running, Auto off.
 * @param {{ size?: 52 | 200, start?: string }} [o]
 */
export function longJobFacts(o = {}) {
  return factsFrom(longJobSource(o));
}

function factsFrom(src) {
  const { slug, title, branch, gate } = src;
  const thread = threadOf(src);
  const docs = listedDocs(src);
  const lastRun = src.audit.filter((e) => e.action === 'run-ended').at(-1);
  const review = { at: src.docs.find((d) => d.file === 'review.md').updatedAt, rows: reviewRows(src.reviewText) };
  const checks = { ...checkCounts(src.reportText), at: src.docs.find((d) => d.file === 'test-report.md').updatedAt };
  return {
    v: 1,
    lane: 'needs-you',
    laneReason: 'Waiting for your go-ahead on PR #1',
    card: {
      slug, title, kind: 'feature', stage: 'review', stageState: 'waiting_for_you', skipped: [],
      needsYou: true, working: false, paused: false, limitPaused: null, restartPaused: null,
      waitingFor: 'approval', waitingSince: gate.waitingSince, permissions: 0, nowDoing: [],
      level: 3, repo: { name: 'fieldbook', branch }, cost: { totalUsd: src.size === 52 ? 96.4 : 385.6 },
      auto: { on: false }, lock: null, closed: null, parked: false, testing: false,
      wireframes: src.wireframes, walkthrough: null,
    },
    detail: {
      gate,
      permissionsPending: [],
      run: { id: `run-${slug}-last`, status: 'done', startedAt: lastRun.at, lastAction: null },
      drive: { mode: 'workshop', model: 'claude-opus-5-5' },
      heldReply: null,
      answeredBriefs: src.briefs.slice(0, -1).map((b) => b.number),
      decidedOnYourBehalf: src.decided,
      spec: { version: '0.4' },
      auto: { on: false, tag: null },
      page: {
        ticket: null,
        times: stepTimes({ briefs: src.briefs, startedAt: src.firstAt, stage: 'review', kind: 'feature', skipped: [] }),
        docs: stepDocs(docs, 'feature'),
        checks,
        check: { version: '3', ...readAcceptance(src.acceptText) },
        handTest: { startedAt: checks.at },
        plan: { version: '2', steps: stepStates(planSteps(src.planText), src.commits, false) },
        review,
        prs: prRows([{ number: 1, url: null, state: 'not_started' }], null),
      },
    },
    thread,
    commits: src.commits.length,
    evidence: {
      evidence: src.evidence, commit: src.evidence.commit, wanted: true, why: 'Level 3 jobs record their checks.',
      recording: false, problem: null, progress: null, watch: false,
      folder: `/demo/jobs/${slug}/evidence/${src.evidence.commit}`, folderUrl: `file:///demo/jobs/${slug}/evidence/${src.evidence.commit}/`,
    },
    usage: null,
    hosted: false,
  };
}

// ---------- The page: payload and bodies ----------

/**
 * The payload and the bodies the page fetches by id, as GET /api/job/:slug/item answers them:
 * { id, kind, html, text, meta }. One body per conversation line (kind: the line's kind) and one
 * per document a step shows (kind 'doc', id: its file).
 * @param {{ size?: 52 | 200, start?: string }} [o]
 */
export function longJobPage(o = {}) {
  const src = longJobSource(o);
  const facts = factsFrom(src);
  const payload = buildJobPage(facts);
  const items = new Map(facts.thread.map((it) => [String(it.id), it]));
  const briefText = new Map(src.briefs.map((b) => [b.file, b.text]));
  const docByFile = new Map(src.docs.map((d) => [d.file, d]));
  const bodies = {};
  for (const line of payload.thread) {
    const it = items.get(line.id);
    const text = it.kind === 'reply' ? it.reply : it.kind === 'brief' ? briefText.get(it.file) : it.text;
    const meta = { at: line.at, step: line.step, hash: line.hash, words: wordCount(text) };
    if (it.kind === 'brief') Object.assign(meta, { number: it.number, stage: it.stage, file: it.file, answered: line.answered });
    if (it.kind === 'you') Object.assign(meta, { sendKind: it.sendKind, gateBrief: it.gateBrief ?? null });
    bodies[line.id] = { id: line.id, kind: line.kind, html: renderMarkdown(text), text, meta };
  }
  for (const step of payload.steps) {
    for (const out of step.outputs) {
      if (out.kind !== 'doc' || bodies[out.id]) continue;
      const d = docByFile.get(out.id);
      bodies[out.id] = { id: out.id, kind: 'doc', html: renderMarkdown(d.text), text: d.text, meta: { name: out.label, version: out.version, updatedAt: d.updatedAt, step: step.id, words: wordCount(d.text) } };
    }
  }
  // The review's findings and the Test step's facts (Task 14), as the item route answers them.
  for (const b of [findingsSource(facts.detail.page), checksSource(facts.detail.page)]) bodies[b.id] = { id: b.id, kind: b.kind, html: renderMarkdown(b.text), text: b.text, meta: b.meta };
  return { counts: src.counts, facts, payload, bodies, commits: src.commits };
}
