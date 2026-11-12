// The job page's overview facts (Part 3, design 3.1): what acceptance.md says the job is checked
// against. The rest of the overview (the ticket, what we're building) is put together by jobDetail
// in runner/index.js from ticket.md, the session record and the Key points in summaries/.
// Each step's time and documents (design 3.2): stepTimes and stepDocs, read into page.times and
// page.docs by jobDetail, and copied onto each step's StageView (lib/stage-view.js).

import { STAGE_STOP, STOP_IDS, stagesOf, stopOf } from './stage-view.js';
import { detectStage } from './stages.js';

const WORKS_WHEN = /^##\s+It works when\s*:?\s*$/i;
const MUST_NOT = /^##\s+It must not\s*:?\s*$/i;
const NUMBERED = /^\s*\d+[.)]\s+(.*\S)\s*$/;
// The requirement ids the line is traced to, at its end: (FR-001) or (FR-002, FR-003).
const FR_BRACKETS = /\s*\(FR-[^()]*\)\s*$/;

/**
 * The numbered lines under `## It works when` and `## It must not` of an acceptance.md, without
 * their trailing (FR-…) brackets: { worksWhen, mustNot }, a list empty when its heading has no
 * numbered lines. Null when neither heading is there. A list ends at the next heading.
 */
export function readAcceptance(text) {
  if (typeof text !== 'string') return null;
  const out = { worksWhen: [], mustNot: [] };
  let list = null;
  let found = false;
  for (const line of text.split(/\r?\n/)) {
    if (WORKS_WHEN.test(line)) { list = out.worksWhen; found = true; continue; }
    if (MUST_NOT.test(line)) { list = out.mustNot; found = true; continue; }
    if (/^#/.test(line)) { list = null; continue; }
    const m = list ? NUMBERED.exec(line) : null;
    if (!m) continue;
    const item = m[1].replace(FR_BRACKETS, '').trim();
    if (item) list.push(item);
  }
  return found ? out : null;
}

// ---------- Each step's time and documents (design 3.2) ----------

/** The step a brief's stage belongs to (briefs/NNN-<stage>.md; a detail brief goes with its stage), or null. */
function briefStop(stage) {
  const s = String(stage ?? '');
  return stopOf(Object.hasOwn(STAGE_STOP, s) ? s : detectStage(s));
}

/**
 * When each step ran, by its briefs: { [stop]: { startedAt, endedAt } } for all seven steps.
 * A step the job has left ends at its last brief's `at`; one it left with no brief of its own has no
 * times, as one skipped or not reached yet. A step starts where the nearest earlier step that ran
 * ended, the first one at `startedAt` (the new-job audit line's time, or null). The current step
 * (the one `stage` belongs to) has no end while the job is open; on a closed job (`closed`: the
 * session's { at, as } mark, dropped or done) it ends at the closed time, else at its own last brief.
 * A brief's time is its file's, which moves when an older brief is rewritten: a step starts at the
 * latest time seen so far, and one whose end would come before that has no start. Pure.
 */
export function stepTimes({ briefs = [], startedAt = null, stage = null, kind = null, skipped = [], closed = null } = {}) {
  const current = STOP_IDS.indexOf(stopOf(stage));
  const skip = new Set(skipped ?? []);
  const lastAt = {};
  for (const b of briefs ?? []) {
    const stop = briefStop(b?.stage);
    if (stop && typeof b.at === 'string') lastAt[stop] = b.at;
  }
  const out = {};
  const ms = (t) => (typeof t === 'string' ? Date.parse(t) : NaN);
  // A span from `from` to `end`: no start when the end comes before it.
  const span = (from, end) => ({ startedAt: end && ms(end) < ms(from) ? null : from, endedAt: end });
  let from = startedAt ?? null;
  STOP_IDS.forEach((stop, i) => {
    const allSkipped = stagesOf(stop, kind).every((s) => skip.has(s));
    if (current < 0 || i > current || (i < current && (allSkipped || !lastAt[stop]))) {
      out[stop] = { startedAt: null, endedAt: null };
    } else if (i === current) {
      const end = closed ? (typeof closed.at === 'string' ? closed.at : lastAt[stop] ?? null) : null;
      out[stop] = span(from, end);
    } else {
      out[stop] = span(from, lastAt[stop]);
      // The latest time seen so far: an end earlier than it doesn't move the next start back.
      if (!(ms(lastAt[stop]) < ms(from))) from = lastAt[stop];
    }
  });
  return out;
}

// The step each known document belongs to. The plan file is drawn under Plan and again under Build.
const DOC_STEPS = {
  spec: ['spec'], 'requirements.md': ['spec'], 'ticket.md': ['spec'],
  'wireframes.html': ['spec'], 'wireframes.json': ['spec'], 'wireframes.brief.md': ['spec'],
  'findings.md': ['investigate'],
  'implementation-plan.md': ['plan', 'build'], 'quick-plan.md': ['plan', 'build'],
  'test-plan.md': ['plan'], 'acceptance.md': ['plan'], 'dev-tests.md': ['plan'], 'manual-test.md': ['plan'],
  'implementation-log.md': ['build'],
  'test-report.md': ['test'], 'evidence/evidence.json': ['test'],
  'review.md': ['review'],
};
// A bug job's own: the reproduction (its Investigate step) and the diagnosis, which is its plan
// (lib/options.js), so under Plan and again under Build.
const BUG_DOC_STEPS = { 'repro.md': ['investigate'], 'diagnosis.md': ['plan', 'build'] };

function docSteps(file, kind) {
  const f = String(file ?? '');
  if (kind === 'bug' && Object.hasOwn(BUG_DOC_STEPS, f)) return BUG_DOC_STEPS[f];
  if (Object.hasOwn(DOC_STEPS, f)) return DOC_STEPS[f];
  if (/^(review|fable)\/[^/]+\.md$/.test(f)) return ['review'];
  const m = /^briefs\/\d+-(.+)\.md$/.exec(f);
  const stop = m ? briefStop(m[1]) : null;
  return stop ? [stop] : [];
}

/**
 * A job's documents (listJobDocs entries, in their order) by the step they belong to:
 * { spec, investigate, plan, build, test, review, ship, none }, each a list (none: notes, status and
 * anything not known). A brief goes to the step of its stage (a bug job's triage, reproduce and
 * diagnose have theirs in STAGE_STOP). `kind` 'bug' also files repro.md and diagnosis.md. Pure.
 */
export function stepDocs(docs = [], kind = null) {
  const out = Object.fromEntries([...STOP_IDS, 'none'].map((k) => [k, []]));
  for (const d of docs ?? []) {
    const steps = docSteps(d?.file, kind);
    for (const s of steps.length ? steps : ['none']) out[s].push(d);
  }
  return out;
}

// ---------- Plan, Build and Ship facts (design 3.2, Part 3 Task 4) ----------

// A plan step's heading: `### S3: The list` (an id as parseLog in lib/git.js reads it from a commit).
const STEP_HEADING = /^###\s+(S\d+[a-z]?)\s*:\s*(.*\S)\s*$/;
// A code fence's marker: it ends at a line of the same character, at least as long (``` inside ~~~ doesn't).
const FENCE = /^\s*(`{3,}|~{3,})/;
// How many steps the page keeps, and how long a name: the job record must fit the website's limit.
const PLAN_STEPS_MAX = 50;
const PLAN_STEP_NAME_MAX = 200;

/**
 * Every `### S<n>: <name>` heading of a plan (implementation-plan.md, else quick-plan.md), in the
 * order written: [{ id, name }], the first 50, each name cut at 200 characters. The name is
 * everything after the first colon, without a closing run of #s. Headings inside a ``` or ~~~ code
 * block don't count. None (a plan from before this change, or no text): []. Pure.
 */
export function planSteps(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  let fence = null; // the open block's marker
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line)?.[1];
    if (f && !fence) { fence = f; continue; }
    if (f && f[0] === fence[0] && f.length >= fence.length) { fence = null; continue; }
    const m = fence ? null : STEP_HEADING.exec(line);
    const name = m ? m[2].replace(/\s+#+\s*$/, '').trim() : '';
    if (name) out.push({ id: m[1], name: name.slice(0, PLAN_STEP_NAME_MAX) });
    if (out.length === PLAN_STEPS_MAX) break;
  }
  return out;
}

/**
 * Each plan step's state: done when a commit's `step` is its id exactly; while `building` (the job
 * is at Build and working) the first step not done is `now`; the rest `next`. Pure.
 */
export function stepStates(steps, commits, building) {
  const built = new Set((Array.isArray(commits) ? commits : []).map((c) => c?.step).filter((s) => typeof s === 'string'));
  let nowGiven = !building;
  return (Array.isArray(steps) ? steps : []).filter((s) => typeof s?.id === 'string').map((s) => {
    if (built.has(s.id)) return { id: s.id, name: s.name, state: 'done' };
    if (!nowGiven) { nowGiven = true; return { id: s.id, name: s.name, state: 'now' }; }
    return { id: s.id, name: s.name, state: 'next' };
  });
}

/**
 * The page's plan: { version, steps } with each step's state, or null when the plan has no steps.
 * A finished job (planDone) has every step done, and reads no commits: once its commits reach the
 * base branch, or its branch is deleted, the read would find none. Otherwise readCommits() (the
 * branch's commits, each with its `step`) is called only for a job at Build or later; before Build
 * every step is `next`. A read that fails counts as no commits.
 */
export async function planView({ text, version = null, stage = null, building = false, finished = false, readCommits = async () => [] } = {}) {
  const steps = planSteps(text);
  if (!steps.length) return null;
  if (finished) return { version: version ?? null, steps: steps.map((s) => ({ id: s.id, name: s.name, state: 'done' })) };
  const built = STOP_IDS.indexOf(stopOf(stage)) >= STOP_IDS.indexOf('build');
  const commits = built ? await Promise.resolve().then(readCommits).catch(() => []) : [];
  return { version: version ?? null, steps: stepStates(steps, commits, building) };
}

const PR_STATE = { open: 'open', draft: 'draft', merged: 'merged', closed: 'closed' };
// status.json's word for a PR (lib/status-json.js PR_STATES): a review word means it is open.
const STATUS_PR_STATE = { not_started: 'not-started', open: 'open', changes_requested: 'open', approved: 'open', merged: 'merged', closed: 'closed' };
const STATUS_REVIEW = { open: 'waiting', changes_requested: 'changes', approved: 'approved' };
const LANE_REVIEW = { approved: 'approved', changes_requested: 'changes', review_required: 'waiting' };
const LANE_CHECKS = { passing: 'passed', pending: 'running', failing: 'failed' };
const str = (v) => (typeof v === 'string' && v ? v : null);
// A word's entry in a map, or null (never one of Object's own names).
const wordIn = (map, word) => (typeof word === 'string' && Object.hasOwn(map, word) ? map[word] : null);
const prNumber = (url) => {
  const m = /\/pull\/(\d{1,9})(?:[/?#]|$)/.exec(String(url ?? ''));
  return m ? Number(m[1]) : null;
};

/**
 * The job's three pull requests, always three: [{ n: 1 | 2 | 3, number, title, url, state, review,
 * checks, openedAt, updatedAt }]. status.json's entry (`prs`, by its `number` 1 to 3), overlaid
 * with the flow lane's pr1 and pr2 (lib/flow.js laneOf; PR #3, the release, is status.json's only).
 * The lane's review: approved, changes, or waiting (review_required or none) on an open pull
 * request, null on one not open; its checks: passed, running, failed or null. An unknown word is
 * null. Without the lane, status.json's word gives the state and review. Pure.
 */
export function prRows(prs, lane) {
  const list = Array.isArray(prs) ? prs : [];
  const laneOf = (n) => {
    const p = n === 1 ? lane?.pr1 : n === 2 ? lane?.pr2 : null;
    return p && typeof p === 'object' ? p : null;
  };
  return [1, 2, 3].map((n) => {
    const s = list.find((p) => p && typeof p === 'object' && Number(p.number) === n) ?? null;
    const word = String(s?.state ?? '').toLowerCase();
    // An older record with only a url counts as open (lib/finish.js).
    let state = wordIn(STATUS_PR_STATE, word) ?? (str(s?.url) ? 'open' : 'not-started');
    let review = state === 'open' ? wordIn(STATUS_REVIEW, word) ?? 'waiting' : null;
    let checks = null;
    const p = laneOf(n);
    if (p) {
      state = wordIn(PR_STATE, String(p.state ?? '').toLowerCase()) ?? state;
      review = state !== 'open' ? null : p.review == null ? 'waiting' : wordIn(LANE_REVIEW, p.review);
      checks = wordIn(LANE_CHECKS, p.checks);
    }
    const url = str(p?.url) ?? str(s?.url);
    return {
      n,
      number: Number.isInteger(p?.number) ? p.number : prNumber(url),
      title: str(p?.title),
      url,
      state,
      review,
      checks,
      openedAt: str(p?.createdAt),
      updatedAt: str(p?.updatedAt),
    };
  });
}

/**
 * Whether a job's plan is all built: it was closed as done (`closed`: the session's { as, at } mark,
 * passed only while it holds, the runner's closedOff), or its PR #1 is merged (status.json or the
 * flow lane, as prRows reads them). A job closed as dropped is not. Pure.
 */
export function planDone({ closed = null, prs = null, lane = null } = {}) {
  return closed?.as === 'done' || prRows(prs, lane)[0].state === 'merged';
}

/** Set `key` in a Map as its newest entry, then drop the oldest until at most `max` are left. */
export function keepLatest(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
  return value;
}

// ---------- The Tester's check counts (design 3.5) ----------

// An acceptance line's id (AC-1, AC-01) and the Tester's mark on the same line of test-report.md.
// Upper case, whole words only: prose says "pass" and "failed" without meaning a mark.
const AC_ID = /\bAC-(\d{1,4})\b/g;
const CHECK_MARK = /\b(NOT RUN|PASS(?:ED)?|FAIL(?:ED)?)\b/g;

// The one mark a report line gives every AC on it: FAIL when it has both a pass word and a fail
// word (a count must never call a failing check passed), otherwise its first mark. Null when none.
function lineMark(line) {
  const words = [...line.matchAll(CHECK_MARK)].map((m) => m[1].replace(/ED$/, ''));
  if (!words.length) return null;
  if (words.includes('PASS') && words.includes('FAIL')) return 'FAIL';
  return words[0];
}

/**
 * How the Tester's checks came out, by test-report.md: { passed, failed, notRun }, one count per
 * acceptance line (AC-<n>) the report marks PASS, FAIL or NOT RUN (PASSED and FAILED too) on the
 * same line, every AC on a line taking that line's mark and its last mention winning (a line
 * checked again). Null when no line is marked. Pure.
 */
export function checkCounts(reportText) {
  if (typeof reportText !== 'string') return null;
  const marks = new Map();
  for (const line of reportText.split(/\r?\n/)) {
    const ids = [...line.matchAll(AC_ID)];
    const mark = ids.length ? lineMark(line) : null;
    if (mark) for (const id of ids) marks.set(Number(id[1]), mark);
  }
  if (!marks.size) return null;
  const out = { passed: 0, failed: 0, notRun: 0 };
  for (const mark of marks.values()) {
    if (mark === 'PASS') out.passed += 1;
    else if (mark === 'FAIL') out.failed += 1;
    else out.notRun += 1;
  }
  return out;
}
