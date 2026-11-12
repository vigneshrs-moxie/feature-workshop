// The full mirror, the laptop's half (packet 2B, decision G9): which parts of the job record go up
// to the hosted site, and in what shape. runner/site-link.js sends each part as a `record` event
// ({ kind, key, value }) when it changes, and value null when it is gone.
//
//   board         the snapshot the Desk and Jobs draw from: the job cards, the waiting permission
//                 cards, the usage meters, and the page's settings (no write token, no folders)
//   job/<slug>    the job page (GET /api/job/:slug): status, briefs, the gate card, decisions, costs
//                 and timing, branch and PR names, the crew's activity and the now line
//   docs/<slug>   the Docs tab's list;  doc/<slug>\n<file>  one of the Foreman's documents
//   decisions/<slug>   the Decisions tab;  evidence/<slug>   the evidence list (the files go to Blob)
//   stacks        the Stacks home;  stack/<slug>   one stack;  stack-part/<slug>/<n>   one part's page
//
// What never goes up (§2.4 "Never carries"): source, diffs, .env, database contents or a token.
//   - The conversation's replies stay on the laptop: each is a line saying so. Your own messages,
//     the briefs, decisions, notes, problems and routine steps go up.
//   - A reply in progress goes up as its state only (no streamed text, no last answer).
//   - A permission card goes up as its headline and risk, and the command for a shell step or the
//     question for a question; the content of a file it would write or edit stays here.
//   - The audit, Always-allow drafts and the write token stay here.
//   - A crew member's last command goes up scrubbed and without its output (activity lastCommand.tail
//     is null); the feed and the command go up once (not in costDetail.activity).
//   - wireSafe() then drops any key named diff, patch, env or token at any depth, and carries a
//     short label under `source` (a cost's "estimate") as `sourceTag`, which the site turns back.
// Every value is then made by lib/protocol.js makeEvent (scrubbed of tokens) and checked again by
// the site, which refuses a record that fails.

import { NEVER_CARRIED } from '../lib/protocol.js';
import { scrub } from '../lib/orbit.js';
import { capAutoLog } from '../lib/auto-log.js';

/** The largest one part may be on the wire (a batch is at most 256 KB). */
export const RECORD_MAX = 200 * 1024;
const LABEL = /^[\w .:/-]{1,60}$/;
const REPLY_LINE = 'The Foreman replied here. Its words show on your laptop.';
const TOO_BIG = 'This is too big to show on the site. Open it on your laptop.';

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * A copy with no never-carried key at any depth. `source` holding a short label (not code) travels
 * as `sourceTag`; anything else under a never-carried name is left out.
 */
export function wireSafe(value, depth = 0) {
  if (depth > 40) return null;
  if (Array.isArray(value)) return value.map((v) => wireSafe(v, depth + 1));
  if (!isPlain(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (NEVER_CARRIED.includes(k)) {
      if (k === 'source' && typeof v === 'string' && LABEL.test(v)) out.sourceTag = v;
      continue;
    }
    if (k === 'sourceTag') continue;
    out[k] = wireSafe(v, depth + 1);
  }
  return out;
}

/** The site's side of wireSafe: `sourceTag` back to `source`. */
export function fromWire(value, depth = 0) {
  if (depth > 40) return null;
  if (Array.isArray(value)) return value.map((v) => fromWire(v, depth + 1));
  if (!isPlain(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k === 'sourceTag' ? 'source' : k] = fromWire(v, depth + 1);
  return out;
}

/** A reply's state, without its words. */
export function runState(run) {
  if (!isPlain(run)) return run ?? null;
  return {
    id: run.id, slug: run.slug, title: run.title, kind: run.kind, model: run.model, status: run.status,
    startedAt: run.startedAt, endedAt: run.endedAt, lastAction: run.lastAction ?? null, pending: run.pending ?? 0,
    stopReason: run.stopReason ?? null, mode: run.mode ?? null, newJob: run.newJob ?? null,
  };
}

/** As far as the laptop's card shows a command (lib/permissions.js describePermission cuts it here too). */
const SHELL_PREVIEW_MAX = 4000;

/**
 * A shell card's preview for the website: the whole raw command scrubbed first, then cut, so a secret
 * across the cut is still hidden. The laptop's own card keeps the raw command. Without the command,
 * the laptop's preview as it is (makeEvent scrubs it).
 */
function shellPreview(p, plain) {
  if (typeof p.input?.command !== 'string') return { preview: plain.preview ?? null, previewCut: plain.previewCut ?? null };
  const whole = scrub(p.input.command);
  return whole.length > SHELL_PREVIEW_MAX ? { preview: `${whole.slice(0, SHELL_PREVIEW_MAX)}…`, previewCut: SHELL_PREVIEW_MAX } : { preview: whole, previewCut: null };
}

/** A permission card as the site shows it. */
export function permissionCard(p) {
  if (!isPlain(p)) return null;
  const shell = p.toolName === 'Bash' || p.toolName === 'PowerShell';
  const question = p.kind === 'question';
  const input = question ? { questions: p.input?.questions ?? [] }
    : shell ? { command: p.input?.command ?? null, description: p.input?.description ?? null }
      : { ...(typeof p.input?.file_path === 'string' ? { file_path: p.input.file_path } : {}) };
  const plain = p.plain ?? {};
  return {
    id: p.id, slug: p.slug, runId: p.runId ?? null, title: p.title ?? null, kind: p.kind, toolName: p.toolName,
    createdAt: p.createdAt ?? null, expiresAt: p.expiresAt ?? null, agentType: p.agentType ?? null, input,
    plain: {
      headline: plain.headline ?? 'The Foreman asks for permission', detail: plain.detail ?? null, blockedPath: plain.blockedPath ?? null,
      risk: plain.risk ?? null, ...(shell ? shellPreview(p, plain) : { preview: null, previewCut: null }),
      ...(shell || question ? {} : { previewNote: 'What it would write shows on your laptop.' }),
    },
    decisionReason: p.decisionReason ?? null, defaultToNo: Boolean(p.defaultToNo), canAllowForRun: Boolean(p.canAllowForRun),
    hardLine: p.hardLine ?? null, fromAutoMode: Boolean(p.fromAutoMode), draft: null, suggestions: [],
  };
}

/** One conversation item as it goes up. */
function threadItem(t) {
  if (!isPlain(t)) return null;
  if (t.kind === 'reply') return { id: t.id, kind: 'note', at: t.at ?? null, text: t.stopped ? `${REPLY_LINE} (It was stopped.)` : REPLY_LINE };
  if (t.kind === 'blocked') return { ...t, preview: null };
  return t;
}

/** The page's settings (no folders, scripts or token). */
function metaOf(m) {
  if (!isPlain(m)) return null;
  const keep = ['stages', 'agents', 'prices', 'crewModels', 'demo', 'models', 'finishLines', 'jobOptions', 'levels'];
  const out = Object.fromEntries(keep.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));
  const s = m.settings ?? {};
  out.settings = { policy: s.policy ?? null, jobPolicy: {}, autoMode: s.autoMode ?? null, play: s.play ?? null, workflow: s.workflow ?? null };
  out.skill = m.skill ? { installed: Boolean(m.skill.installed), levels: Boolean(m.skill.levels), path: '' } : null;
  return out;
}

// ---------- The parts ----------

export function boardRecord(snap) {
  return wireSafe({
    meta: metaOf(snap.meta), jobs: snap.jobs ?? [], needsYou: snap.needsYou ?? 0,
    permissions: (snap.permissions ?? []).map(permissionCard).filter(Boolean),
    usage: snap.usage ?? null, planUsage: snap.planUsage ?? null, runTypical: snap.runTypical ?? null, generatedAt: snap.generatedAt ?? null,
  });
}

/**
 * The crew's activity as it goes up: a command's output stays on the laptop; the command, when it ran
 * and the feed's lines go up scrubbed of secrets (lib/orbit.js scrub; the laptop parsed them scrubbed
 * already, and this holds for a record from anywhere).
 */
function activityUp(list) {
  if (!Array.isArray(list)) return list;
  return list.map((a) => {
    if (!isPlain(a)) return a;
    const out = { ...a };
    if (isPlain(a.lastCommand)) out.lastCommand = { ...a.lastCommand, command: scrub(a.lastCommand.command), tail: null };
    if (Array.isArray(a.recent)) out.recent = a.recent.map((r) => (isPlain(r) ? { ...r, text: scrub(r.text) } : r));
    return out;
  });
}

/** The cost part's copy of the activity: the feed and the command go up once, with `activity` (not here). */
function costActivityUp(list) {
  if (!Array.isArray(list)) return list;
  return list.map((a) => {
    if (!isPlain(a)) return a;
    const { recent, lastCommand, ...rest } = a;
    return rest;
  });
}

/**
 * Where the job's branch came from, without a path (lib/locate.js locateJob): the website reads
 * branchGuessed to show a guessed branch as a guess. The folders and the paths tried stay here.
 */
function locateUp(locate) {
  if (!isPlain(locate)) return null;
  return { branch: locate.branch ?? null, branchSource: locate.branchSource ?? null, branchGuessed: locate.branchGuessed === true };
}

export function jobRecord(detail) {
  const { audit, lastReply, locate, runs, run, permissionsPending, thread, ...rest } = detail;
  return wireSafe({
    ...rest,
    locate: locateUp(locate),
    ...('activity' in rest ? { activity: activityUp(rest.activity) } : {}),
    ...(isPlain(rest.costDetail) && 'activity' in rest.costDetail ? { costDetail: { ...rest.costDetail, activity: costActivityUp(rest.costDetail.activity) } } : {}),
    run: runState(run), runs: (runs ?? []).map(runState),
    permissionsPending: (permissionsPending ?? []).map(permissionCard).filter(Boolean),
    thread: (thread ?? []).map(threadItem).filter(Boolean),
  });
}

export const docsRecord = (docs) => wireSafe(docs);
export const docRecord = (doc) => wireSafe(doc);
export const decisionsRecord = (d) => wireSafe(d);
/** What Auto decided on a job: { on, stopped, tag, summary, entries, startedAt, ticket }, each entry with its kind and step (the site cleans it again on its side). */
export function autoLogRecord(v) {
  // Cut to the site's own limits first, then the oldest entries go until it fits: the site refuses a part that is too big and would show nothing.
  const capped = wireSafe(capAutoLog(v));
  while (Array.isArray(capped?.entries) && capped.entries.length > 0 && fit('auto-log', capped).tooBig) capped.entries = capped.entries.slice(0, Math.floor(capped.entries.length / 2));
  return capped;
}

/** The evidence list, without the laptop's folder names (the site links each file itself). */
export function evidenceRecord(view) {
  const { folder, folderUrl, ...rest } = view ?? {};
  return wireSafe(rest);
}

/** Every picture and video an evidence list names, and each finished line's video its progress names: [file]. */
export function evidenceFiles(view) {
  const out = [];
  for (const c of view?.evidence?.criteria ?? []) {
    for (const s of c.screenshots ?? []) if (typeof s?.file === 'string') out.push(s.file);
    if (typeof c.video === 'string') out.push(c.video);
    else if (typeof c.video?.file === 'string') out.push(c.video.file);
  }
  for (const l of view?.progress?.lines ?? []) if (typeof l?.video === 'string') out.push(l.video);
  return [...new Set(out)];
}

export const stacksRecord = (list) => wireSafe(list);
export function stackRecord(view) {
  const { readChanges, ...rest } = view ?? {};
  return wireSafe(rest);
}
export const partRecord = (page) => wireSafe(page);

/** How many review rows and Auto lines a job that is too big keeps. */
const REVIEW_ROWS_KEPT = 30;
const AUTO_DECIDED_KEPT = 20;

/**
 * What a job's record sheds after its conversation, in this order, while it is still too big. The
 * gate and the three calls' data (gate, heldReply, answeredBriefs, permissionsPending) are never shed.
 */
const JOB_SHEDS = [
  // The feed and last command of a crew member no longer running.
  (v) => (Array.isArray(v.activity)
    ? { ...v, activity: v.activity.map((a) => (isPlain(a) && a.state !== 'running' ? (({ recent, lastCommand, ...kept }) => kept)(a) : a)) }
    : v),
  // The Docs list again: the website has it as its own part (docs/<slug>).
  (v) => (isPlain(v.page) && v.page.docs != null ? { ...v, page: { ...v.page, docs: null } } : v),
  // The review's rows beyond the first 30, marked cut.
  (v) => (Array.isArray(v.page?.review?.rows) && v.page.review.rows.length > REVIEW_ROWS_KEPT
    ? { ...v, page: { ...v.page, review: { ...v.page.review, rows: v.page.review.rows.slice(0, REVIEW_ROWS_KEPT), cut: true } } }
    : v),
  // What Auto decided beyond the newest 20 (the list is oldest first).
  (v) => (isPlain(v.auto) && Array.isArray(v.auto.decided) && v.auto.decided.length > AUTO_DECIDED_KEPT
    ? { ...v, auto: { ...v.auto, decided: v.auto.decided.slice(-AUTO_DECIDED_KEPT) } }
    : v),
];

/**
 * The part as it goes on the wire, cut to fit: a document loses its rendered copy first; a job its
 * brief's rendered copy and oldest conversation lines, then JOB_SHEDS one at a time until it fits.
 * Anything still too big says so instead.
 */
export function fit(kind, value) {
  const size = (v) => Buffer.byteLength(JSON.stringify(v ?? null));
  if (value === null || size(value) <= RECORD_MAX) return value;
  if (kind === 'doc' && typeof value.text === 'string') {
    const lighter = { ...value, html: null, cut: true, text: value.text.slice(0, RECORD_MAX / 2) };
    if (size(lighter) <= RECORD_MAX) return lighter;
  }
  if (kind === 'job' && isPlain(value)) {
    let v = { ...value, latestBrief: value.latestBrief ? { ...value.latestBrief, html: null } : null };
    if (Array.isArray(v.thread)) while (v.thread.length > 5 && size(v) > RECORD_MAX) v = { ...v, thread: v.thread.slice(Math.ceil(v.thread.length / 4)), threadMore: true };
    for (const shed of JOB_SHEDS) {
      if (size(v) <= RECORD_MAX) return v;
      v = shed(v);
    }
    if (size(v) <= RECORD_MAX) return v;
  }
  return { tooBig: true, words: TOO_BIG };
}
