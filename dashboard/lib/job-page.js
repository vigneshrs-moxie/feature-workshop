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

// ---------- The Tester's check counts (design 3.5) ----------

// An acceptance line's id (AC-1, AC-01) and the Tester's mark on the same line of test-report.md.
const AC_ID = /\bAC-(\d{1,4})\b/;
const CHECK_MARK = /\b(NOT RUN|PASS|FAIL)\b/;

/**
 * How the Tester's checks came out, by test-report.md: { passed, failed, notRun }, one count per
 * acceptance line (AC-<n>) the report marks PASS, FAIL or NOT RUN on the same line, its last mention
 * winning (a line checked again). Null when no line is marked. Pure.
 */
export function checkCounts(reportText) {
  if (typeof reportText !== 'string') return null;
  const marks = new Map();
  for (const line of reportText.split(/\r?\n/)) {
    const id = AC_ID.exec(line);
    const mark = id ? CHECK_MARK.exec(line) : null;
    if (mark) marks.set(Number(id[1]), mark[1]);
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
