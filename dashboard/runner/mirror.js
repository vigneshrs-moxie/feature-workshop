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
//   - wireSafe() then drops any key named diff, patch, env or token at any depth, and carries a
//     short label under `source` (a cost's "estimate") as `sourceTag`, which the site turns back.
// Every value is then made by lib/protocol.js makeEvent (scrubbed of tokens) and checked again by
// the site, which refuses a record that fails.

import { NEVER_CARRIED } from '../lib/protocol.js';

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
      risk: plain.risk ?? null, preview: shell ? plain.preview ?? null : null, previewCut: shell ? plain.previewCut ?? null : null,
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

export function jobRecord(detail) {
  const { audit, lastReply, locate, runs, run, permissionsPending, thread, ...rest } = detail;
  return wireSafe({
    ...rest,
    run: runState(run), runs: (runs ?? []).map(runState),
    permissionsPending: (permissionsPending ?? []).map(permissionCard).filter(Boolean),
    thread: (thread ?? []).map(threadItem).filter(Boolean),
  });
}

export const docsRecord = (docs) => wireSafe(docs);
export const docRecord = (doc) => wireSafe(doc);
export const decisionsRecord = (d) => wireSafe(d);

/** The evidence list, without the laptop's folder names (the site links each file itself). */
export function evidenceRecord(view) {
  const { folder, folderUrl, ...rest } = view ?? {};
  return wireSafe(rest);
}

/** Every picture and video an evidence list names: [{ file, type }]. */
export function evidenceFiles(view) {
  const out = [];
  for (const c of view?.evidence?.criteria ?? []) {
    for (const s of c.screenshots ?? []) if (typeof s?.file === 'string') out.push(s.file);
    if (typeof c.video === 'string') out.push(c.video);
    else if (typeof c.video?.file === 'string') out.push(c.video.file);
  }
  return [...new Set(out)];
}

export const stacksRecord = (list) => wireSafe(list);
export function stackRecord(view) {
  const { readChanges, ...rest } = view ?? {};
  return wireSafe(rest);
}
export const partRecord = (page) => wireSafe(page);

/**
 * The part as it goes on the wire, cut to fit: a document loses its rendered copy first, a job its
 * oldest conversation lines; anything still too big says so instead.
 */
export function fit(kind, value) {
  const size = (v) => Buffer.byteLength(JSON.stringify(v ?? null));
  if (value === null || size(value) <= RECORD_MAX) return value;
  if (kind === 'doc' && typeof value.text === 'string') {
    const lighter = { ...value, html: null, cut: true, text: value.text.slice(0, RECORD_MAX / 2) };
    if (size(lighter) <= RECORD_MAX) return lighter;
  }
  if (kind === 'job' && Array.isArray(value.thread)) {
    let v = { ...value, latestBrief: value.latestBrief ? { ...value.latestBrief, html: null } : null };
    while (v.thread.length > 5 && size(v) > RECORD_MAX) v = { ...v, thread: v.thread.slice(Math.ceil(v.thread.length / 4)), threadMore: true };
    if (size(v) <= RECORD_MAX) return v;
  }
  return { tooBig: true, words: TOO_BIG };
}
