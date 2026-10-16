// The Play layer's ledger (docs/plans/play-layer-2026-10-16.md): the crew you have met, the quests
// you have finished, achievements and secrets found. Personal and local: built only from data the
// dashboard already has (audit.jsonl, each job's status.json, review.md, the session logs' worker
// list). Never calls a model, never rewards an approval: nothing here reads what a gate or a
// permission card was answered with.
//
// buildLedger() is pure (data in, ledger out): an AuditFold of the audit entries plus the jobs,
// merged with the ledger before (ledgerFrom). PlayBook keeps the ledger in <state dir>/play.json,
// written atomically and only when it changed, folds each new audit line in as it is written, and
// rebuilds it from the audit log when the file is missing or from another schema. Secrets and
// themes tried are audit lines too ('play-secret', 'play-event'), so a rebuild finds them again.
// While Play mode is Off nothing here runs (the server neither schedules nor answers).
//
// Rules a later step must keep:
//   - A quest is a job reaching "done", by the Settings → Play rule: its first PR is created
//     (status.json prs[0] has a URL; the default) or you mark the job done. Counted once per job
//     (slug + folder): reopening it and finishing again never awards it twice.
//   - Once unlocked, an achievement stays unlocked, whatever happens to the job later.
//   - Crew are met only by working: a worker in a session log, a dispatch the dashboard allowed by
//     itself (auto-allowed), or an audit line the worker itself caused (agentType). A permission you
//     allowed by hand meets no one.

import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENTS } from './stages.js';
import { REVIEWERS } from './options.js';

export const PLAY_SCHEMA = 1;

// ---------- Settings (settings.json `play`) ----------

export const PLAY_MODES = ['subtle', 'full', 'off'];
export const QUEST_DONE_RULES = ['first-pr', 'marked-done'];
export const PLAY_DEFAULTS = Object.freeze({ mode: 'subtle', questDone: 'first-pr', sounds: false });

export class PlayError extends Error {}

/** The play settings with every field valid (anything unknown falls back to its default). */
export function playSettings(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: PLAY_MODES.includes(p.mode) ? p.mode : PLAY_DEFAULTS.mode,
    questDone: QUEST_DONE_RULES.includes(p.questDone) ? p.questDone : PLAY_DEFAULTS.questDone,
    sounds: typeof p.sounds === 'boolean' ? p.sounds : PLAY_DEFAULTS.sounds,
  };
}

/** A change to the play settings from the page: only known fields with allowed values. Throws PlayError. */
export function validatePlayPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new PlayError('Play settings must be an object.');
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'mode') {
      if (!PLAY_MODES.includes(v)) throw new PlayError('Play mode: pick Full, Subtle or Off.');
      out.mode = v;
    } else if (k === 'questDone') {
      if (!QUEST_DONE_RULES.includes(v)) throw new PlayError('A quest counts as done when the first PR is created, or when you mark the job done.');
      out.questDone = v;
    } else if (k === 'sounds') {
      if (typeof v !== 'boolean') throw new PlayError('Sounds: on or off.');
      out.sounds = v;
    } else {
      throw new PlayError(`Unknown play setting: ${String(k).slice(0, 40)}.`);
    }
  }
  if (!Object.keys(out).length) throw new PlayError('Nothing to change.');
  return out;
}

// ---------- What can be met, tried and found ----------

/** All 15 crew members, the Foreman first (lib/stages.js AGENTS). */
export const CREW_TYPES = Object.keys(AGENTS);
/** The 8 review lenses (lib/options.js REVIEWERS). */
export const LENS_TYPES = REVIEWERS.map((r) => r.id);
/** Themes the page can say you tried (web/src/theme/theme.ts THEMES); Explorer needs the five besides Default. */
export const THEME_IDS = ['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop'];
export const EXPLORER_THEMES = THEME_IDS.filter((t) => t !== 'default');
/** The 13 easter eggs (design doc section 5). Only these ids can be recorded. */
export const SECRET_IDS = [
  'konami', 'hammertime', 'sandwich', 'rm-rf', 'git-blame', 'teapot', 'console',
  'headers', 'sleuth-404', 'hex-sommelier', 'foreman-clicks', 'friday-push', 'seasonal-hats',
];
/** Things the page may report (POST /api/play/event): kind → allowed ids. */
export const PLAY_EVENTS = { theme: THEME_IDS };

const SPEEDRUN_MS = 15 * 60 * 1000;
const BUG_HUNTER_COUNT = 10;
/** Quests done that unlock the hidden Gold theme (step 5). */
export const GOLD_QUESTS = 10;

// ---------- Achievements ----------

const SECRET_NAMES = {
  konami: ['Up, Up, Down, Down', 'Entered the Konami code.'],
  hammertime: ['Stop! Hammer Time', 'Asked the palette for hammertime.'],
  sandwich: ['Okay.', 'Asked nicely, with sudo.'],
  'rm-rf': ['Nice Try', 'Tried rm -rf / in the palette.'],
  'git-blame': ['Not It', 'Ran git blame on the crew.'],
  teapot: ['Short and Stout', 'Found the teapot.'],
  console: ['Behind the Curtain', 'Opened the console and read the crew’s note.'],
  headers: ['Clacks Overhead', 'Read the response headers.'],
  'sleuth-404': ['Lost and Found', 'Got lost; the Sleuth looked for you.'],
  'hex-sommelier': ['Hex Sommelier', 'A commit whose hash starts with c0ffee, dead, beef or f00d.'],
  'foreman-clicks': ['Seven Knocks', 'Knocked on the Foreman seven times.'],
  'friday-push': ['Friday Deploy', 'Pushed on a Friday afternoon. The Locksmith noticed.'],
  'seasonal-hats': ['Hat Season', 'Saw the crew in their seasonal hats.'],
};

/** Every achievement: id, name, how to get it, secret (an easter egg: hidden until found). */
export const ACHIEVEMENTS = [
  { id: 'first-quest', name: 'First Quest', howTo: 'Finish your first quest.', secret: false },
  { id: 'clean-sweep', name: 'Clean Sweep', howTo: 'Get a job’s first review round back from the lenses with zero findings.', secret: false },
  { id: 'speedrun', name: 'Speedrun', howTo: 'Take an L0 job from start to done in 15 minutes or less.', secret: false },
  { id: 'full-panel', name: 'Full Panel', howTo: 'Have all 8 review lenses look at one job.', secret: false },
  { id: 'boss-slayer', name: 'Boss Slayer', howTo: 'Finish an L3 quest.', secret: false },
  { id: 'bug-hunter', name: 'Bug Hunter', howTo: `Finish ${BUG_HUNTER_COUNT} bug quests.`, secret: false },
  { id: 'night-owl', name: 'Night Owl', howTo: 'Finish a quest between midnight and 4am.', secret: false },
  { id: 'comeback', name: 'Comeback', howTo: 'Finish a job on the same day it carried on after a usage-limit pause.', secret: false },
  { id: 'explorer', name: 'Explorer', howTo: 'Try all five themes besides Default.', secret: false },
  { id: 'collector', name: 'Collector', howTo: `Meet all ${CREW_TYPES.length} crew members.`, secret: false },
  ...SECRET_IDS.map((id) => ({ id: `secret-${id}`, name: SECRET_NAMES[id][0], howTo: SECRET_NAMES[id][1], secret: true })),
];
const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achievementInfo(id, unlockedAt = null) {
  const a = ACHIEVEMENT_BY_ID.get(id);
  return a ? { ...a, unlockedAt } : null;
}

// ---------- Reading review.md ----------

/** The review lens a word in review.md names ("errors", "Locksmith", "db"), as its agent type. */
export function lensType(word) {
  const w = String(word ?? '').trim().toLowerCase().replace(/[`*_]/g, '');
  if (!w) return null;
  if (/^(spec|correctness|conformance|reviewer|head inspector|overall)$/.test(w)) return 'feature-reviewer';
  const single = (s) => s.replace(/s$/, '');
  for (const r of REVIEWERS) {
    const suffix = r.id.replace(/^feature-review(er)?-?/, '');
    if (r.label.toLowerCase() === w || (suffix && single(suffix) === single(w))) return r.id;
  }
  if (/^(database|data|migrations?|schema)$/.test(w)) return 'feature-review-db';
  if (/^(perf|speed)$/.test(w)) return 'feature-review-performance';
  if (/^(permission|auth|access)$/.test(w)) return 'feature-review-permissions';
  return null;
}

const SEVERITY = (cell) => {
  const s = String(cell ?? '').trim().toLowerCase().replace(/[`*_]/g, '');
  if (s.startsWith('blocker')) return 'blockers';
  if (s.startsWith('major')) return 'majors';
  if (s.startsWith('minor')) return 'minors';
  return null;
};

/** A review.md that is the Foreman's own pre-PR diff check, not a lens review round. */
export const PRE_PR_CHECK = /Pre-PR diff check/i;
// A "Result:" / "Summary:" line (any markdown around the label), or a Result/Summary heading.
const SUMMARY_LABEL = /^[\s>*_#-]*(result|summary|verdict)\b/i;
const NO_FINDINGS = /\b(no|zero) findings\b|\bnothing (was )?found\b/i;
// A findings-table row taken back: dropped, or a false positive.
const TAKEN_BACK = /\b(dropped|false[ -]positives?)\b/i;

/**
 * The findings a combined lens review (review.md) reports: { blockers, majors, minors, total, byLens }
 * (byLens: { [agentType]: { blockers, majors, minors } }, from a findings table with a Lens
 * column), or null when the file says nothing countable or is a pre-PR diff check. Reads
 * "0 blockers, 2 majors, 3 minors" (from a Result/summary line first), else counts a table's
 * Severity column (rows marked dropped or false positive left out), else "No findings" on a
 * Result/summary line is zero.
 */
export function parseReviewFindings(text) {
  if (typeof text !== 'string' || !text.trim() || PRE_PR_CHECK.test(text)) return null;
  const lines = text.split('\n');
  // Result/summary lines: labelled ones, and the first line under a Result/Summary heading.
  const summaryLines = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!SUMMARY_LABEL.test(t)) continue;
    summaryLines.push(t);
    if (/^#/.test(t)) {
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (next && !/^#/.test(next.trim())) summaryLines.push(next.trim());
    }
  }
  const counted = (word) => {
    const re = new RegExp(`(\\d{1,4})\\s+${word}s?\\b`, 'i');
    for (const l of summaryLines) { const m = re.exec(l); if (m) return Number(m[1]); }
    const m = re.exec(text);
    return m ? Number(m[1]) : null;
  };
  const summary = { blockers: counted('blocker'), majors: counted('major'), minors: counted('minor') };

  // A findings table: a header row with a Severity column (and maybe a Lens column).
  const table = { blockers: 0, majors: 0, minors: 0 };
  const byLens = {};
  let rows = 0;
  let cols = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) { cols = null; continue; }
    const cells = t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (!cols) {
      const lower = cells.map((c) => c.toLowerCase());
      const sev = lower.indexOf('severity');
      cols = sev >= 0 ? { sev, lens: lower.indexOf('lens') } : { sev: -1, lens: -1 };
      continue;
    }
    if (cols.sev < 0 || cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (cells.some((c) => TAKEN_BACK.test(c))) continue;
    const sev = SEVERITY(cells[cols.sev]);
    if (!sev) continue;
    rows++;
    table[sev]++;
    const lens = cols.lens >= 0 ? lensType(cells[cols.lens]) : null;
    if (lens) {
      byLens[lens] ??= { blockers: 0, majors: 0, minors: 0 };
      byLens[lens][sev]++;
    }
  }

  let counts;
  if (summary.blockers !== null || summary.majors !== null || summary.minors !== null) {
    counts = { blockers: summary.blockers ?? 0, majors: summary.majors ?? 0, minors: summary.minors ?? 0 };
  } else if (rows) {
    counts = table;
  } else if (summaryLines.some((l) => NO_FINDINGS.test(l))) {
    counts = { blockers: 0, majors: 0, minors: 0 };
  } else {
    return null;
  }
  return { ...counts, total: counts.blockers + counts.majors + counts.minors, byLens };
}

// ---------- Building the ledger (pure) ----------

const ms = (t) => {
  const n = typeof t === 'number' ? t : Date.parse(t ?? '');
  return Number.isFinite(n) ? n : null;
};
const iso = (n) => new Date(n).toISOString();
const minAt = (a, b) => (a == null ? b : b == null ? a : ms(a) <= ms(b) ? a : b);
const maxAt = (a, b) => (a == null ? b : b == null ? a : ms(a) >= ms(b) ? a : b);
const sameLocalDay = (a, b) => {
  const x = new Date(ms(a));
  const y = new Date(ms(b));
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};
const baseName = (dir) => String(dir ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

/** A job's key in the ledger: its slug and its folder, so a reused slug is a new quest. */
export const jobKey = (slug, dir) => `${slug || baseName(dir)}|${dir ?? ''}`;

const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
// The crew member an Agent/Task step the dashboard allowed by itself started ("Start a helper:
// feature-tester", lib/permissions.js). A dispatch you allowed by hand is not a meeting: the worker
// is met when its session log shows it ran, so clicking Allow never earns anything.
function dispatchTarget(e) {
  if (!DISPATCH_TOOLS.has(e.tool) || e.action !== 'auto-allowed') return null;
  const type = typeof e.dispatch === 'string' ? e.dispatch : /Start a helper:\s*([\w-]+)/.exec(String(e.headline ?? ''))?.[1];
  return CREW_TYPES.includes(type) ? type : null;
}

const emptyCounts = () => ({ blockers: 0, majors: 0, minors: 0 });

/**
 * What the audit log says for the ledger, folded in one entry at a time (PlayBook folds each new
 * audit line as it is written, and reads the whole file only at start or when it shrank or was
 * replaced). Folding an entry twice changes nothing: times are min/max, dispatches and resumes
 * are sets, so a line seen both in a full read and as it was written counts once.
 */
export class AuditFold {
  constructor() {
    /** dir -> { slug, startedAt, firstDoneClose, level } */
    this.byDir = new Map();
    /** at -> { dirs: Set | null, slugs: Set }: carried on after a usage-limit pause */
    this.resumes = new Map();
    this.secrets = {};
    this.themes = {};
    this.foremanAt = null;
    /** type -> { firstSeen, lastSeen, jobs: { key: { firstSeen, dispatches: Set } } } */
    this.crew = {};
  }

  dirInfo(dir, slug) {
    if (!this.byDir.has(dir)) this.byDir.set(dir, { slug: slug ?? baseName(dir), startedAt: null, firstDoneClose: null, level: null });
    const d = this.byDir.get(dir);
    if (slug && !d.slug) d.slug = slug;
    return d;
  }

  #meet(type, at, key, dispatchId = null) {
    if (!CREW_TYPES.includes(type) || !at) return;
    const c = (this.crew[type] ??= { firstSeen: at, lastSeen: at, jobs: {} });
    c.firstSeen = minAt(c.firstSeen, at);
    c.lastSeen = maxAt(c.lastSeen, at);
    if (!key) return;
    const j = (c.jobs[key] ??= { firstSeen: at, dispatches: new Set() });
    j.firstSeen = minAt(j.firstSeen, at);
    if (dispatchId) j.dispatches.add(dispatchId);
  }

  add(e) {
    if (!e || typeof e !== 'object' || !ms(e.at)) return this;
    const dir = typeof e.featureDir === 'string' ? e.featureDir : null;
    const d = dir ? this.dirInfo(dir, typeof e.slug === 'string' ? e.slug : null) : null;
    const key = d ? jobKey(d.slug, dir) : null;
    switch (e.action) {
      case 'new-job':
        d && (d.startedAt = minAt(d.startedAt, e.at));
        if (d && Number.isInteger(e.options?.level)) d.level = e.options.level;
        this.foremanAt = minAt(this.foremanAt, e.at);
        break;
      case 'send':
        // Only when the job started: never what was said, so an approval counts for nothing.
        d && (d.startedAt = minAt(d.startedAt, e.at));
        break;
      case 'run-ended':
      case 'takeover':
        this.foremanAt = minAt(this.foremanAt, e.at);
        break;
      case 'options':
        if (d && Number.isInteger(e.options?.level)) d.level = e.options.level;
        break;
      case 'close':
        if (d && e.as === 'done') d.firstDoneClose = minAt(d.firstDoneClose, e.at);
        break;
      case 'usage-limit-resumed': {
        // featureDirs (since the Play layer) name the jobs exactly; older lines only have slugs.
        const r = this.resumes.get(e.at) ?? { dirs: null, slugs: new Set() };
        for (const slug of Array.isArray(e.jobs) ? e.jobs : []) if (typeof slug === 'string') r.slugs.add(slug);
        if (Array.isArray(e.featureDirs)) {
          r.dirs ??= new Set();
          for (const f of e.featureDirs) if (typeof f === 'string') r.dirs.add(f);
        }
        this.resumes.set(e.at, r);
        break;
      }
      case 'play-secret':
        if (SECRET_IDS.includes(e.id)) this.secrets[e.id] = minAt(this.secrets[e.id], e.at);
        break;
      case 'play-event':
        if (e.kind === 'theme' && THEME_IDS.includes(e.id)) this.themes[e.id] = minAt(this.themes[e.id], e.at);
        break;
      default:
        break;
    }
    const target = dispatchTarget(e);
    if (target) this.#meet(target, e.at, key, `${e.at}|${e.toolUseId ?? ''}|${target}`);
    if (typeof e.agentType === 'string' && e.agentType !== target) this.#meet(e.agentType, e.at, key);
    return this;
  }
}

/**
 * The ledger from local data.
 *   audit     every audit.jsonl entry, oldest first
 *   jobs      [{ slug, dir, kind, level, prs, updatedAt, startedAt?, prLinks?: [{ url, at }],
 *               workers: [{ agentType, startedAt, lastAt }], review: { at, counts } | null }]
 *             (startedAt: the job's first session line; prLinks: the PRs its session logs say were
 *             created, with when; counts: parseReviewFindings)
 *   play      the play settings (playSettings)
 *   now       a Date or ms: the time quests found right now are stamped with when nothing better is known
 *   previous  the ledger from play.json, or null to rebuild from scratch. What it holds is kept:
 *             quests, achievements, crew met, secrets and themes never go away.
 */
export function buildLedger({ audit = [], ...rest } = {}) {
  const fold = new AuditFold();
  for (const e of audit) fold.add(e);
  return ledgerFrom({ fold, ...rest });
}

const prKey = (url) => {
  const m = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i.exec(String(url ?? ''));
  return m ? `${m[1]}/${m[2]}#${m[3]}`.toLowerCase() : String(url ?? '').trim().replace(/\/+$/, '').toLowerCase();
};
/** When the job's first PR was created, from its session logs' PR links: an ISO time or null. */
function firstPrAt(pr, links) {
  if (!pr?.url || !Array.isArray(links)) return null;
  const want = prKey(pr.url);
  const hits = links.filter((l) => l?.url && ms(l.at) && prKey(l.url) === want);
  return hits.length ? hits.map((l) => l.at).reduce(minAt) : null;
}

/** buildLedger from an AuditFold (not changed: the ledger gets its own copies). */
export function ledgerFrom({ fold = new AuditFold(), jobs = [], play = PLAY_DEFAULTS, now = Date.now(), previous = null } = {}) {
  const nowIso = iso(ms(now) ?? Date.now());
  const rule = playSettings(play).questDone;
  const prev = previous && previous.schema === PLAY_SCHEMA ? previous : null;

  // --- What the audit says, per job folder (copies: the jobs below add start times) ---
  const byDir = new Map([...fold.byDir].map(([dir, d]) => [dir, { ...d }]));
  const dirInfo = (dir, slug) => {
    if (!byDir.has(dir)) byDir.set(dir, { slug: slug ?? baseName(dir), startedAt: null, firstDoneClose: null, level: null });
    const d = byDir.get(dir);
    if (slug && !d.slug) d.slug = slug;
    return d;
  };
  const secrets = { ...(prev?.secrets ?? {}) };
  for (const [id, at] of Object.entries(fold.secrets)) secrets[id] = minAt(secrets[id], at);
  const themes = { ...(prev?.themes ?? {}) };
  for (const [id, at] of Object.entries(fold.themes)) themes[id] = minAt(themes[id], at);
  let foremanAt = fold.foremanAt;

  // --- Crew: type -> { firstSeen, lastSeen, jobs: { key: { firstSeen, audit, workers } }, time: { totalMs, n } } ---
  const crew = {};
  for (const [type, c] of Object.entries(fold.crew)) {
    const jobsOf = {};
    for (const [k, j] of Object.entries(c.jobs)) jobsOf[k] = { firstSeen: j.firstSeen, audit: j.dispatches.size, workers: 0 };
    crew[type] = { firstSeen: c.firstSeen, lastSeen: c.lastSeen, jobs: jobsOf, time: { totalMs: 0, n: 0 } };
  }
  const meet = (type, at, key) => {
    if (!CREW_TYPES.includes(type) || !at) return null;
    const c = (crew[type] ??= { firstSeen: at, lastSeen: at, jobs: {}, time: { totalMs: 0, n: 0 } });
    c.firstSeen = minAt(c.firstSeen, at);
    c.lastSeen = maxAt(c.lastSeen, at);
    if (key) {
      const j = (c.jobs[key] ??= { firstSeen: at, audit: 0, workers: 0 });
      j.firstSeen = minAt(j.firstSeen, at);
    }
    return c;
  };

  // --- Jobs on disk: their workers (session logs), quests and reviews ---
  const quests = { ...(prev?.quests ?? {}) };
  const reviews = { ...(prev?.reviews ?? {}) };
  const seenJobs = new Set();
  for (const job of jobs) {
    if (!job?.dir) continue;
    const key = jobKey(job.slug, job.dir);
    seenJobs.add(key);
    const d = dirInfo(job.dir, job.slug);
    for (const w of Array.isArray(job.workers) ? job.workers : []) {
      const at = w?.startedAt ?? w?.lastAt;
      const c = meet(w?.agentType, at, key);
      if (!c) continue;
      c.jobs[key].workers++;
      if (w.lastAt) c.lastSeen = maxAt(c.lastSeen, w.lastAt);
      const took = ms(w.lastAt) - ms(w.startedAt);
      if (Number.isFinite(took) && took >= 0) { c.time.totalMs += took; c.time.n++; }
      d.startedAt = minAt(d.startedAt, w.startedAt ?? null);
      foremanAt = minAt(foremanAt, at); // someone dispatched them
    }
    if (job.startedAt && ms(job.startedAt)) d.startedAt = minAt(d.startedAt, job.startedAt);

    if (job.review?.counts) reviews[key] = reviewRecord(reviews[key], job.review, LENS_TYPES.some((t) => crew[t]?.jobs?.[key]), nowIso);

    const exactPrAt = rule === 'first-pr' ? firstPrAt(job.prs?.[0], job.prLinks) : null;
    if (quests[key]) {
      // Counted once, whatever happens to the job later; only a guessed time is put right.
      const q = quests[key];
      if (q.rule === 'first-pr' && q.doneAtExact === false && exactPrAt) quests[key] = { ...q, doneAt: exactPrAt, doneAtExact: true };
      continue;
    }
    let doneAt = null;
    let exact = true;
    if (rule === 'first-pr') {
      if (job.prs?.[0]?.url) {
        // When the PR was created, from the session log; else status.json's time (or now), marked
        // as a guess so the time-of-day achievements leave it out.
        doneAt = exactPrAt ?? minAt(job.updatedAt && ms(job.updatedAt) ? job.updatedAt : null, nowIso) ?? nowIso;
        exact = Boolean(exactPrAt);
      }
    } else if (d.firstDoneClose) {
      doneAt = d.firstDoneClose;
    }
    if (doneAt) quests[key] = questRecord(job.slug, job.dir, doneAt, exact, job.kind, levelOf(job, d), d, rule);
  }
  // Jobs marked done whose folder is gone (only the audit remembers them), when that is the rule.
  if (rule === 'marked-done') {
    for (const [dir, d] of byDir) {
      const key = jobKey(d.slug, dir);
      if (quests[key] || seenJobs.has(key) || !d.firstDoneClose) continue;
      quests[key] = questRecord(d.slug, dir, d.firstDoneClose, true, null, d.level, d, rule);
    }
  }

  // --- Merge the crew with what was met before ---
  for (const [type, p] of Object.entries(prev?.crew ?? {})) {
    if (!CREW_TYPES.includes(type)) continue;
    const c = crew[type];
    if (!c) { crew[type] = structuredClone(p); continue; }
    c.firstSeen = minAt(c.firstSeen, p.firstSeen);
    c.lastSeen = maxAt(c.lastSeen, p.lastSeen);
    for (const [k, pj] of Object.entries(p.jobs ?? {})) {
      const j = c.jobs[k];
      if (!j) { c.jobs[k] = { ...pj }; continue; }
      j.firstSeen = minAt(j.firstSeen, pj.firstSeen);
      j.audit = Math.max(j.audit, pj.audit ?? 0);
      j.workers = Math.max(j.workers, pj.workers ?? 0);
    }
    if ((p.time?.n ?? 0) > c.time.n) c.time = { ...p.time };
  }
  if (foremanAt) {
    const c = (crew.conductor ??= { firstSeen: foremanAt, lastSeen: foremanAt, jobs: {}, time: { totalMs: 0, n: 0 } });
    c.firstSeen = minAt(c.firstSeen, foremanAt);
  }

  // --- Achievements: what the data earns now, kept with what was earned before ---
  const earned = earnedAchievements({ quests, reviews, crew, themes, secrets, resumes: [...fold.resumes].map(([at, r]) => ({ at, ...r })) });
  const achievements = { ...(prev?.achievements ?? {}) };
  for (const [id, at] of Object.entries(earned)) {
    if (!achievements[id]) achievements[id] = { unlockedAt: at };
  }

  return { schema: PLAY_SCHEMA, builtAt: nowIso, questDone: rule, crew, quests, reviews, achievements, secrets, themes };
}

function levelOf(job, d) {
  if (Number.isInteger(job.level)) return job.level;
  return Number.isInteger(d.level) ? d.level : null;
}

function questRecord(slug, dir, doneAt, doneAtExact, kind, level, d, rule) {
  return {
    slug: slug || baseName(dir), featureDir: dir, doneAt, doneAtExact, kind: kind === 'bug' ? 'bug' : 'feature',
    level: Number.isInteger(level) ? level : null, startedAt: d.startedAt ?? null, rule,
  };
}

/**
 * A job's review record: the latest round's counts, the most each lens ever raised on it (per
 * severity, across rounds) and its first lens round, which is kept as it was: later rewrites of
 * review.md never change it. A round counts as the first only once a review lens has run for the
 * job; Clean Sweep is that first round coming back with nothing (draining to clean later is the
 * boss fight's "Boss defeated", not this).
 */
function reviewRecord(was, review, lensRan, nowIso) {
  const counts = review.counts;
  const at = review.at ?? nowIso;
  const byLens = counts.byLens ?? {};
  const byLensMax = {};
  for (const src of [was?.byLensMax ?? was?.byLens ?? {}, byLens]) {
    for (const [type, c] of Object.entries(src)) {
      const m = (byLensMax[type] ??= emptyCounts());
      for (const k of ['blockers', 'majors', 'minors']) m[k] = Math.max(m[k], c?.[k] ?? 0);
    }
  }
  const first = was?.first ?? (lensRan ? { at, blockers: counts.blockers, majors: counts.majors, minors: counts.minors, total: counts.total } : null);
  return {
    blockers: counts.blockers, majors: counts.majors, minors: counts.minors, total: counts.total, at, byLens, byLensMax, first,
    cleanAt: first && first.total === 0 ? first.at : null,
  };
}

function earnedAchievements({ quests, reviews, crew, themes, secrets, resumes }) {
  const out = {};
  const set = (id, at) => { if (at) out[id] = minAt(out[id], at); };
  const list = Object.values(quests).sort((a, b) => ms(a.doneAt) - ms(b.doneAt));

  for (const q of list) {
    set('first-quest', q.doneAt);
    if (q.level === 3) set('boss-slayer', q.doneAt);
    // The time-of-day ones need to know when the quest was really done, not a guess.
    if (q.doneAtExact === false) continue;
    if (new Date(ms(q.doneAt)).getHours() < 4) set('night-owl', q.doneAt);
    if (q.level === 0 && q.startedAt) {
      const took = ms(q.doneAt) - ms(q.startedAt);
      if (took >= 0 && took <= SPEEDRUN_MS) set('speedrun', q.doneAt);
    }
    const resumedThisJob = (r) => (r.dirs ? r.dirs.has(q.featureDir) : r.slugs.has(q.slug));
    if (resumes.some((r) => resumedThisJob(r) && ms(r.at) <= ms(q.doneAt) && sameLocalDay(r.at, q.doneAt))) set('comeback', q.doneAt);
  }
  const bugs = list.filter((q) => q.kind === 'bug');
  if (bugs.length >= BUG_HUNTER_COUNT) set('bug-hunter', bugs[BUG_HUNTER_COUNT - 1].doneAt);

  for (const r of Object.values(reviews)) set('clean-sweep', r.cleanAt);

  // Full Panel: every lens on the same job; earned when the last of them arrived.
  const jobsSeen = new Set(LENS_TYPES.flatMap((t) => Object.keys(crew[t]?.jobs ?? {})));
  for (const key of jobsSeen) {
    const times = LENS_TYPES.map((t) => crew[t]?.jobs?.[key]?.firstSeen ?? null);
    if (times.every(Boolean)) set('full-panel', times.reduce(maxAt));
  }

  if (EXPLORER_THEMES.every((t) => themes[t])) set('explorer', EXPLORER_THEMES.map((t) => themes[t]).reduce(maxAt));
  if (CREW_TYPES.every((t) => crew[t]?.firstSeen)) set('collector', CREW_TYPES.map((t) => crew[t].firstSeen).reduce(maxAt));
  for (const id of SECRET_IDS) if (secrets[id]) set(`secret-${id}`, secrets[id]);
  return out;
}

/** Achievements unlocked in `next` that weren't in `before`, each with its name and how-to. */
export function newlyUnlocked(before, next) {
  const had = before?.achievements ?? {};
  return Object.entries(next?.achievements ?? {})
    .filter(([id]) => !had[id])
    .map(([id, a]) => achievementInfo(id, a.unlockedAt))
    .filter(Boolean)
    .sort((a, b) => ms(a.unlockedAt) - ms(b.unlockedAt));
}

/**
 * What GET /api/play sends: crew met with stats, quests done, achievements (an easter egg's only
 * once found: the rest are just counted), secrets found, themes tried and what is unlocked.
 */
export function ledgerView(ledger, play = PLAY_DEFAULTS) {
  const l = ledger ?? { crew: {}, quests: {}, reviews: {}, achievements: {}, secrets: {}, themes: {} };
  // Blockers and majors per lens: the most each raised on each job, over every review round.
  const findings = {};
  for (const r of Object.values(l.reviews ?? {})) {
    for (const [type, c] of Object.entries(r.byLensMax ?? r.byLens ?? {})) {
      findings[type] ??= emptyCounts();
      for (const k of ['blockers', 'majors', 'minors']) findings[type][k] += c[k] ?? 0;
    }
  }
  const crew = {};
  for (const type of CREW_TYPES) {
    const c = l.crew?.[type];
    if (!c) continue;
    const jobs = Object.values(c.jobs ?? {});
    crew[type] = {
      firstSeen: c.firstSeen, lastSeen: c.lastSeen, jobs: Object.keys(c.jobs ?? {}).length,
      dispatches: jobs.reduce((n, j) => n + Math.max(j.audit ?? 0, j.workers ?? 0), 0),
      avgStageMs: c.time?.n ? Math.round(c.time.totalMs / c.time.n) : null,
      blockers: findings[type]?.blockers ?? 0, majors: findings[type]?.majors ?? 0,
    };
  }
  // The Foreman is never dispatched itself: it hands the work out. Its jobs are every job its crew
  // worked on, its dispatches the work it handed out, and it was last seen when they were.
  if (crew.conductor) {
    const keys = new Set(Object.keys(l.crew.conductor.jobs ?? {}));
    let handedOut = 0;
    for (const type of CREW_TYPES) {
      if (type === 'conductor' || !crew[type]) continue;
      for (const k of Object.keys(l.crew[type].jobs ?? {})) keys.add(k);
      handedOut += crew[type].dispatches;
      crew.conductor.lastSeen = maxAt(crew.conductor.lastSeen, crew[type].lastSeen);
    }
    crew.conductor.jobs = keys.size;
    crew.conductor.dispatches = handedOut;
  }
  const quests = Object.values(l.quests ?? {}).sort((a, b) => ms(b.doneAt) - ms(a.doneAt));
  const achievements = ACHIEVEMENTS
    .filter((a) => !a.secret || l.achievements?.[a.id])
    .map((a) => ({ ...a, unlockedAt: l.achievements?.[a.id]?.unlockedAt ?? null }));
  const found = SECRET_IDS.filter((id) => l.secrets?.[id]);
  const p = playSettings(play);
  return {
    schema: PLAY_SCHEMA, mode: p.mode, questDone: p.questDone,
    crew, crewMet: Object.keys(crew).length, crewTotal: CREW_TYPES.length,
    quests: {
      done: quests.length, bugs: quests.filter((q) => q.kind === 'bug').length,
      recent: quests.slice(0, 50).map((q) => ({ slug: q.slug, doneAt: q.doneAt, kind: q.kind, level: q.level })),
    },
    achievements,
    secrets: { found, total: SECRET_IDS.length },
    themesTried: THEME_IDS.filter((t) => l.themes?.[t]),
    unlocks: { crt: found.includes('konami'), gold: quests.length >= GOLD_QUESTS },
  };
}

// ---------- play.json (the one part that touches files) ----------

/** Two ledgers say the same (builtAt aside). */
export const sameLedger = (a, b) => Boolean(a && b) && JSON.stringify({ ...a, builtAt: null }) === JSON.stringify({ ...b, builtAt: null });

/** How often a refresh may read every job fully (session logs and all) when no fresh list is at hand. */
export const JOBS_EVERY_MS = 60_000;

/**
 * Keeps the ledger in <dir>/play.json, kept up to date cheaply:
 *   - audit lines: noteAudit(entry) folds each one in as it is written; the whole audit.jsonl is
 *     read only at the first refresh, or when it shrank or is another file (inode) since;
 *   - job files: noteJob(folder) marks one job, and the next refresh re-reads only that job's own
 *     files (sources.job); every job (with its workers) comes from sources.jobs({ fresh: true })
 *     when a fresh list is already at hand, else sources.jobs({ fresh: false }) at most every
 *     JOBS_EVERY_MS;
 *   - play.json is written only when the ledger changed (builtAt aside); a failed write is logged
 *     and the ledger in memory stays good.
 * sources: { readAudit() → entries, auditStat() → { size, ino } | null, jobs({ fresh }) → jobs | null,
 *            job(folder, known) → job | null, settings() → the play settings }
 * isOn(): Play mode isn't Off. While it is Off, schedule() does nothing and nothing is folded (the
 * next refresh reads everything again). onUnlock(achievement) is called for each achievement a
 * refresh unlocks: not on a rebuild from scratch (it only finds what was already earned) and not on
 * a muted refresh (refresh({ muted: true }): Play turned back on, or the quest rule changed).
 */
export class PlayBook {
  constructor({ dir, sources, isOn = () => true, onUnlock = () => {}, now = () => Date.now(), jobsEveryMs = JOBS_EVERY_MS, log = (msg, err) => console.error(msg, err) }) {
    this.file = path.join(dir, 'play.json');
    this.dir = dir;
    this.sources = sources;
    this.isOn = isOn;
    this.onUnlock = onUnlock;
    this.now = now;
    this.jobsEveryMs = jobsEveryMs;
    this.log = log;
    this.ledger = null;
    this.loaded = false;
    this.running = null;
    this.again = false;
    this.againMuted = false;
    this.timer = null;
    this.timerMuted = false;
    // What has been read so far.
    this.fold = null;
    this.auditSeen = null; // { size, ino } at the last look
    this.reading = false;
    this.pending = [];
    this.jobs = new Map(); // dir -> job
    this.jobsAt = null;
    this.dirty = new Set(); // job folder names changed since
  }

  /** An audit line was just written: fold it in (or keep it for after the full read under way). */
  noteAudit(entry) {
    if (!this.isOn()) { this.forget(); return; }
    if (this.reading) this.pending.push(entry);
    else if (this.fold) this.fold.add(entry);
    // No fold yet: the first refresh reads the whole file, this line included.
  }

  /** A file in a job's folder changed: re-read that job at the next refresh. */
  noteJob(folder) {
    if (!this.isOn()) { this.forget(); return; }
    if (folder) this.dirty.add(folder);
  }

  /** Play mode Off: stop, and drop what was read, so turning it on again reads everything afresh. */
  forget() {
    clearTimeout(this.timer);
    this.timer = null;
    this.timerMuted = false;
    this.fold = null;
    this.auditSeen = null;
    this.pending = [];
    this.jobsAt = null;
    this.dirty.clear();
  }

  /** Read play.json. Missing, unreadable or another schema: null, so the next refresh rebuilds it. */
  async load() {
    this.loaded = true;
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      this.ledger = data && data.schema === PLAY_SCHEMA && typeof data.quests === 'object' ? data : null;
    } catch {
      this.ledger = null;
    }
    return this.ledger;
  }

  async save(ledger) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    try { await fs.rename(tmp, this.file); } catch (err) { await fs.rm(tmp, { force: true }); throw err; }
  }

  /**
   * Bring the ledger up to date (merged with what it held) and save it when it changed. One at a
   * time: refreshes asked for meanwhile are folded into one more run (muted if any of them was).
   */
  async refresh({ muted = false } = {}) {
    if (this.running) { this.again = true; this.againMuted ||= muted; return this.running; }
    this.running = (async () => {
      try {
        let quiet = muted;
        do {
          this.again = false;
          await this.#build(quiet);
          quiet = this.againMuted;
          this.againMuted = false;
        } while (this.again);
        return this.ledger;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  async #build(muted) {
    if (!this.loaded) await this.load();
    const before = this.ledger;
    await this.#readAudit();
    await this.#readJobs();
    const next = ledgerFrom({ fold: this.fold, jobs: [...this.jobs.values()], play: this.sources.settings(), now: this.now(), previous: before });
    if (before && sameLedger(before, next)) return;
    // The ledger in memory first: a failed write must not lose it (GET /api/play still answers).
    this.ledger = next;
    try { await this.save(next); } catch (err) { this.log('play ledger: could not save play.json:', err); }
    if (before && !muted) for (const a of newlyUnlocked(before, next)) { try { this.onUnlock(a); } catch { /* a listener's problem */ } }
  }

  // The audit: everything at the first build, or when audit.jsonl shrank or was replaced; else the
  // lines noteAudit folded in as they were written are all there is to know.
  async #readAudit() {
    let st = null;
    try { st = (await this.sources.auditStat()) ?? null; } catch { st = null; }
    const seen = this.auditSeen;
    const replaced = st && seen && (st.ino !== seen.ino || st.size < seen.size);
    const gone = !st && seen;
    if (this.fold && !replaced && !gone) { this.auditSeen = st; return; }
    this.reading = true;
    this.pending = [];
    try {
      const fold = new AuditFold();
      for (const e of await this.sources.readAudit()) fold.add(e);
      // Lines written while the file was read: folding one twice changes nothing.
      for (const e of this.pending) fold.add(e);
      this.fold = fold;
      this.auditSeen = st;
    } finally {
      this.reading = false;
      this.pending = [];
    }
  }

  // The jobs: the fresh full list when there is one, else a full read at most every jobsEveryMs;
  // then the jobs whose files changed since, one by one (their status.json and review.md only).
  async #readJobs() {
    const now = this.now();
    let list = await this.sources.jobs({ fresh: true });
    if (!list && (this.jobsAt === null || now - this.jobsAt >= this.jobsEveryMs || now < this.jobsAt)) list = await this.sources.jobs({ fresh: false });
    if (list) {
      this.jobs = new Map(list.filter((j) => j?.dir).map((j) => [j.dir, j]));
      this.jobsAt = now;
    }
    const changed = [...this.dirty];
    this.dirty.clear();
    for (const folder of changed) {
      const known = [...this.jobs.values()].find((j) => baseName(j.dir) === folder) ?? null;
      const job = await this.sources.job(folder, known);
      if (job?.dir) this.jobs.set(job.dir, job);
    }
  }

  /** Refresh a moment after the last call (audit lines and job files come in bursts). Nothing while Play is Off. */
  schedule(delayMs = 1500, { muted = false } = {}) {
    if (!this.isOn()) return;
    clearTimeout(this.timer);
    this.timerMuted ||= muted;
    this.timer = setTimeout(() => {
      const quiet = this.timerMuted;
      this.timer = null;
      this.timerMuted = false;
      if (this.isOn()) this.refresh({ muted: quiet }).catch((err) => this.log('play ledger:', err));
    }, delayMs);
    this.timer.unref?.();
  }

  /** The ledger, built first if it hasn't been yet (or waiting for the build under way). */
  async current() {
    if (this.running) await this.running;
    if (!this.ledger) await this.refresh();
    return this.ledger;
  }
}
