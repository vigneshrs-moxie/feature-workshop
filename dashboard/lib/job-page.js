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
 * (the one `stage` belongs to) has no end. Pure.
 */
export function stepTimes({ briefs = [], startedAt = null, stage = null, kind = null, skipped = [] } = {}) {
  const current = STOP_IDS.indexOf(stopOf(stage));
  const skip = new Set(skipped ?? []);
  const lastAt = {};
  for (const b of briefs ?? []) {
    const stop = briefStop(b?.stage);
    if (stop && typeof b.at === 'string') lastAt[stop] = b.at;
  }
  const out = {};
  let from = startedAt ?? null;
  STOP_IDS.forEach((stop, i) => {
    const allSkipped = stagesOf(stop, kind).every((s) => skip.has(s));
    if (current < 0 || i > current || (i < current && (allSkipped || !lastAt[stop]))) {
      out[stop] = { startedAt: null, endedAt: null };
    } else if (i === current) {
      out[stop] = { startedAt: from, endedAt: null };
    } else {
      out[stop] = { startedAt: from, endedAt: lastAt[stop] };
      from = lastAt[stop];
    }
  });
  return out;
}

// The step each known document belongs to. The plan file is drawn under Plan and again under Build.
const DOC_STEPS = {
  spec: ['spec'], 'requirements.md': ['spec'], 'ticket.md': ['spec'], 'wireframes.html': ['spec'], 'wireframes.json': ['spec'],
  'findings.md': ['investigate'],
  'implementation-plan.md': ['plan', 'build'], 'quick-plan.md': ['plan', 'build'],
  'test-plan.md': ['plan'], 'acceptance.md': ['plan'], 'dev-tests.md': ['plan'], 'manual-test.md': ['plan'],
  'implementation-log.md': ['build'],
  'test-report.md': ['test'], 'evidence/evidence.json': ['test'],
  'review.md': ['review'],
};

function docSteps(file) {
  const f = String(file ?? '');
  if (Object.hasOwn(DOC_STEPS, f)) return DOC_STEPS[f];
  if (/^(review|fable)\/[^/]+\.md$/.test(f)) return ['review'];
  const m = /^briefs\/\d+-(.+)\.md$/.exec(f);
  const stop = m ? briefStop(m[1]) : null;
  return stop ? [stop] : [];
}

/**
 * A job's documents (listJobDocs entries, in their order) by the step they belong to:
 * { spec, investigate, plan, build, test, review, ship, none }, each a list (none: notes, status and
 * anything not known). A brief goes to the step of its stage. `kind` is the job's kind: a bug job's
 * stages (triage, reproduce, diagnose) have their own steps in STAGE_STOP, so both kinds read the same. Pure.
 */
export function stepDocs(docs = [], kind = null) { // eslint-disable-line no-unused-vars
  const out = Object.fromEntries([...STOP_IDS, 'none'].map((k) => [k, []]));
  for (const d of docs ?? []) {
    const steps = docSteps(d?.file);
    for (const s of steps.length ? steps : ['none']) out[s].push(d);
  }
  return out;
}
