// Stacks for big features (packet V): what the Stacks home, a stack's page and a part's own page
// show about each part, worked out from the stack's view (lib/stack.js describeStack), the part
// jobs' cards (what the Jobs page shows: who is at work and on what) and Telemetry's record
// (usage.jsonl: what each part's job has cost). Plain code, apart from the read-only git that
// lists a part's changed files (diffStat, fileDiff), which takes its git from the caller.
//
//   partLane(part, view)          where a part is in its life, in a word: needs you, stuck, waiting
//                                 on another part, ready to start, at work, checks, ready to merge,
//                                 being merged, merged (the board's columns, the bar's segments)
//   nowLine(card, part, lane)     its one line of now: "Builder · editing invoice.ts · 6m ago"
//   stackRisks(view)              clashes, failed merges undone, a stuck part, files not its own
//   stackAsk(view)                the one thing it needs from you, with its one action
//   enrichView(view, live)        the view with each part's lane, now line, cost, waits on / unblocks,
//                                 and the stack's counts, risks, ask, cost and times
//   stackCard(summary, live)      a stack's card on the home
//   partPage(view, n, extra)      a part's own page: its place, its neighbours, its checks, its checklist
//   usageByJob(lines)             Telemetry's record added up by job (and by stack section)
//   diffStat / fileDiff           git diff --numstat and one file's diff, against the stack's branch

const cap0 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const list = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`);
const base = (file) => String(file).split('/').pop() || String(file);
const ms = (iso) => { const t = Date.parse(iso ?? ''); return Number.isNaN(t) ? null : t; };

/** The lanes, in the order a part lives them (the board's columns, left to right, put needs you first). */
export const LANES = ['needs-you', 'stuck', 'waiting', 'queued', 'working', 'checks', 'ready', 'merging', 'merged'];

/** Each lane in words: never a colour alone. */
export const LANE_WORDS = {
  'needs-you': 'Needs you',
  stuck: 'Stuck',
  waiting: 'Waiting on another part',
  queued: 'Ready to start',
  working: 'At work',
  checks: 'Checks running',
  ready: 'Ready to merge',
  merging: 'Being merged',
  merged: 'Merged',
};

/** A part's name on screen: its brief's first words ("The export button"), else its name in the plan. */
export function partTitle(p) {
  const s = String(p?.brief ?? '').split(/(?<=[a-z0-9)])[.:;](?:\s|$)/i)[0].trim();
  if (!s) return p?.name ?? '';
  return s.length > 60 ? `${s.slice(0, 57).trimEnd()}…` : s;
}

/** The parts a part still waits on (by number), in merge order. */
export function waitsOn(part, parts) {
  return (part.dependsOn ?? []).map((d) => parts.find((p) => p.name === d)).filter((p) => p && p.state !== 'integrated').map((p) => p.n);
}

/** The parts that wait on this one (by number). */
export function unblocks(part, parts) {
  return parts.filter((p) => (p.dependsOn ?? []).includes(part.name)).map((p) => p.n);
}

const partsWord = (ns) => (ns.length === 1 ? `part ${ns[0]}` : `parts ${list(ns.map(String))}`);

/**
 * Where a part is: { lane, words }. view: { parts, approved, busy }. A part whose Foreman waits for
 * your go-ahead, or that came back from its merge (a clash, files not its own, nothing to merge),
 * needs you; one that failed its checks three times is stuck.
 */
export function partLane(part, view) {
  const parts = view.parts ?? [];
  const waits = waitsOn(part, parts);
  if (!view.approved) return waits.length ? { lane: 'waiting', words: `Waiting on ${partsWord(waits)}` } : { lane: 'queued', words: LANE_WORDS.queued };
  if (view.busy?.section && view.busy.section === part.name) return { lane: 'merging', words: LANE_WORDS.merging };
  switch (part.state) {
    case 'integrated': return { lane: 'merged', words: LANE_WORDS.merged };
    case 'failed': return { lane: 'stuck', words: LANE_WORDS.stuck };
    case 'ready': return { lane: 'ready', words: LANE_WORDS.ready };
    case 'blocked': {
      const k = part.problem?.kind;
      return { lane: 'needs-you', words: k === 'conflict' ? 'Clash at its merge' : k === 'outside' ? 'Changed files not its own' : k === 'empty' ? 'Nothing to merge' : 'Back with its Foreman' };
    }
    case 'running': {
      if (/waiting for you/i.test(part.progress?.words ?? '')) return { lane: 'needs-you', words: 'Waiting for your go-ahead' };
      if (['test', 'review'].includes(part.progress?.stage)) return { lane: 'checks', words: part.progress.stage === 'review' ? 'In review' : LANE_WORDS.checks };
      return { lane: 'working', words: LANE_WORDS.working };
    }
    default:
      return waits.length ? { lane: 'waiting', words: `Waiting on ${partsWord(waits)}` } : { lane: 'queued', words: LANE_WORDS.queued };
  }
}

// The crew member a part's own stage has at work, when its card doesn't say who.
const CREW = {
  plan: { who: 'Planner', type: 'feature-planner' },
  implement: { who: 'Builder', type: 'feature-implementer' },
  test: { who: 'Tester', type: 'feature-tester' },
  review: { who: 'Reviewer', type: 'feature-reviewer' },
};
const CREW_BY_TYPE = Object.fromEntries(Object.values(CREW).map((c) => [c.type, c.who]));

/** "Editing merge.ts" → "editing merge.ts", but "PR #2 is open" keeps its capital. */
const lowerStart = (s) => (/^[A-Z][a-z]/.test(s) && !/^(PR|CI|Opus|Sonnet|Haiku|GitHub)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * A part's one line of now: { who, crew, what, since, tone } or null when nobody is at it. card:
 * the part job's card (GET /api/features), or null.
 */
export function nowLine(card, part, lane) {
  if (lane === 'merged' || lane === 'waiting' || lane === 'queued') return null;
  const d = (card?.nowDoing ?? []).find((x) => x?.doing) ?? card?.nowDoing?.[0] ?? null;
  if (lane === 'merging') return { who: 'The stack', crew: null, what: 'merging it and running the checks', since: null, tone: 'working' };
  if (d && lane !== 'needs-you' && lane !== 'stuck') {
    const who = d.who === 'conductor' ? 'Foreman' : d.name || CREW_BY_TYPE[d.who] || cap0(String(d.who ?? 'The crew'));
    return { who, crew: d.who === 'conductor' ? 'feature-conductor' : d.who ?? null, what: lowerStart(String(d.doing || 'at work')), since: d.since ?? d.lastAt ?? null, tone: 'working' };
  }
  if (lane === 'needs-you' || lane === 'stuck') {
    const since = card?.waitingSince ?? part.sentBackAt ?? card?.updatedAt ?? null;
    return { who: 'Foreman', crew: 'feature-conductor', what: lane === 'stuck' ? 'stopped: it needs you' : part.state === 'blocked' ? 'waiting for you to hand it back' : 'waiting for your go-ahead', since, tone: 'waiting' };
  }
  if (lane === 'ready') return { who: 'Foreman', crew: 'feature-conductor', what: 'done: its checks passed', since: part.readyAt ?? card?.updatedAt ?? null, tone: 'quiet' };
  const c = CREW[part.progress?.stage] ?? { who: 'The crew', type: null };
  const what = card?.nextProposed || part.progress?.words || 'at work';
  return { who: c.who, crew: c.type, what: lowerStart(String(what)), since: card?.updatedAt ?? part.startedAt ?? null, tone: 'working' };
}

/** A merged part that owns a file, other than `part`: the one a clash is with. */
function ownerOf(file, part, parts) {
  return parts.find((p) => p !== part && p.state === 'integrated' && (p.owns ?? []).some((o) => covers(o, file))) ?? null;
}

/** Whether an owned path ("app/**", "app/*.ts", "app/x.ts") covers a file. */
export function covers(owned, file) {
  const re = new RegExp(`^${String(owned).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
  return re.test(file) || String(file).startsWith(`${String(owned).replace(/\/$/, '')}/`);
}

/**
 * What could go wrong, or did: [{ kind, words, parts: [n], tone }], the worst first. A clash names
 * both parts and the file; a failed merge says it was undone; plan warnings about two parts owning
 * the same file stay until one of them has merged.
 */
export function stackRisks(view) {
  const parts = view.parts ?? [];
  const out = [];
  for (const p of parts.filter((x) => x.state === 'failed')) {
    out.push({ kind: 'stuck', tone: 'error', parts: [p.n], words: `Part ${p.n} is stuck: its tests failed ${p.failures || 3} times` });
  }
  for (const p of parts.filter((x) => x.state === 'blocked' && x.problem)) {
    const files = p.problem.files ?? [];
    if (p.problem.kind === 'conflict') {
      const other = files.map((f) => ownerOf(f, p, parts)).find(Boolean) ?? null;
      const file = files[0] ? base(files[0]) : 'the same files';
      const more = files.length > 1 ? ` and ${files.length - 1} more` : '';
      out.push({ kind: 'clash', tone: 'error', parts: other ? [Math.min(p.n, other.n), Math.max(p.n, other.n)] : [p.n], words: other ? `Clash: parts ${Math.min(p.n, other.n)} and ${Math.max(p.n, other.n)} both change ${file}${more}` : `Clash: part ${p.n} and the stack’s branch both change ${file}${more}` });
    } else if (p.problem.kind === 'outside') {
      out.push({ kind: 'outside', tone: 'error', parts: [p.n], words: `Part ${p.n} changed ${files.length === 1 ? `${base(files[0])}, which isn’t its own` : `${files.length} files that aren’t its own`}` });
    } else if (p.problem.kind === 'empty') {
      out.push({ kind: 'empty', tone: 'warn', parts: [p.n], words: `Part ${p.n} has nothing to merge yet` });
    }
  }
  for (const p of parts.filter((x) => x.state === 'running' && x.problem?.kind === 'checks')) {
    out.push({ kind: 'checks', tone: 'error', parts: [p.n], words: `Tests failed after merging part ${p.n} (undone)` });
  }
  // The plan's own warnings: two parts own the same file, so their merges may clash.
  for (const w of view.plan?.warnings ?? []) {
    const m = /^Sections (\S+) and (\S+) both own (.+?)\. /.exec(w);
    if (!m) continue;
    const a = parts.find((p) => p.name === m[1]);
    const b = parts.find((p) => p.name === m[2]);
    if (!a || !b || a.state === 'integrated' || b.state === 'integrated') continue;
    if (out.some((r) => r.kind === 'clash' && r.parts.includes(a.n) && r.parts.includes(b.n))) continue;
    out.push({ kind: 'overlap', tone: 'warn', parts: [a.n, b.n], words: `Parts ${a.n} and ${b.n} both own ${m[3].split(', ').map(base).join(', ')}, so their merges may clash` });
  }
  return out;
}

/**
 * The one thing the stack needs from you: { words, label, action, part } or null. action: what the
 * button does (approve-plan, merge, fix, open-part, push, fix-plan).
 */
export function stackAsk(view) {
  const parts = view.parts ?? [];
  const n = parts.length;
  if (!view.approved) {
    if (!view.plan) return null;
    if (!view.plan.ok) return { action: 'fix-plan', label: 'Ask the Foreman to fix it', part: null, words: `The plan has ${view.plan.errors.length === 1 ? 'a problem' : `${view.plan.errors.length} problems`} to fix first` };
    return { action: 'approve-plan', label: 'Check the plan', part: null, words: `The Foreman split it into ${n} ${n === 1 ? 'part' : 'parts'}. Check them and approve.` };
  }
  if (view.busy) return null;
  const stuck = parts.find((p) => p.state === 'failed');
  if (stuck) return { action: 'open-part', label: `Open part ${stuck.n}`, part: stuck.n, words: `Part ${stuck.n} got stuck after ${stuck.failures || 3} failed tries` };
  const blocked = parts.find((p) => p.state === 'blocked' && p.problem);
  if (blocked) {
    const k = blocked.problem.kind;
    const what = k === 'conflict' ? 'clashes at its merge' : k === 'outside' ? 'changed files that aren’t its own' : k === 'empty' ? 'has nothing to merge yet' : 'came back from its merge';
    return { action: 'fix', label: 'Let the Foreman fix it', part: blocked.n, words: `Part ${blocked.n} ${what}` };
  }
  if (view.next?.action === 'merge' && view.next.section) {
    const p = parts.find((x) => x.name === view.next.section);
    if (p) return { action: 'merge', label: `Merge part ${p.n}`, part: p.n, words: `Part ${p.n} is ready to merge` };
  }
  if (view.phase === 'push' && view.push?.state !== 'approved') return { action: 'push', label: 'Push', part: null, words: `All ${n} parts are merged and checked` };
  const asks = parts.find((p) => p.state === 'running' && /waiting for you/i.test(p.progress?.words ?? ''));
  if (asks) return { action: 'open-part', label: `Open part ${asks.n}`, part: asks.n, words: `Part ${asks.n} waits for your go-ahead` };
  return null;
}

/** Telemetry's record added up: { jobs: Map(slug → usd), sections: Map("parent\u0000section" → usd) }. */
export function usageByJob(lines) {
  const jobs = new Map();
  const sections = new Map();
  for (const l of lines ?? []) {
    const usd = typeof l?.costUsd === 'number' && Number.isFinite(l.costUsd) ? l.costUsd : 0;
    if (!usd || typeof l.job !== 'string') continue;
    // A line for one section of a stack's job counts for that part, not for the stack's own job.
    if (typeof l.section === 'string' && l.section) {
      const k = `${l.job}\u0000${l.section}`;
      sections.set(k, (sections.get(k) ?? 0) + usd);
    } else jobs.set(l.job, (jobs.get(l.job) ?? 0) + usd);
  }
  return { jobs, sections };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** A part's Claude cost so far: its job in Telemetry's record (or the stack's lines for its section), else its card's. */
function partCost(view, part, card, usage) {
  const fromLog = (part.slug ? usage?.jobs?.get(part.slug) ?? 0 : 0) + (usage?.sections?.get(`${view.slug}\u0000${part.name}`) ?? 0);
  if (fromLog > 0) return { usd: round2(fromLog), source: 'telemetry' };
  const c = card?.cost?.totalUsd;
  return typeof c === 'number' && c > 0 ? { usd: round2(c), source: 'job' } : { usd: 0, source: null };
}

const startOfDay = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * The view with what the new Stack pages show. live: { cards: Map(slug → card), usage:
 * usageByJob(...), now }. Adds to each part: title, lane, laneWords, now, costUsd, waitsOn,
 * unblocks, lastActivityAt; and to the stack: counts (by lane), merged, total, risks, ask, costUsd,
 * startedAt, lastActivityAt, mergedToday.
 */
export function enrichView(view, { cards = new Map(), usage = null, now = Date.now() } = {}) {
  const parts = view.parts ?? [];
  const counts = Object.fromEntries(LANES.map((l) => [l, 0]));
  const log = view.log ?? [];
  const enriched = parts.map((p) => {
    const { lane, words } = partLane(p, view);
    counts[lane] += 1;
    const card = p.slug ? cards.get(p.slug) ?? null : null;
    const cost = partCost(view, p, card, usage);
    const times = [ms(card?.updatedAt), ms(p.mergedAt), ms(p.readyAt), ms(p.startedAt), ...log.filter((l) => l.section === p.name).slice(0, 1).map((l) => ms(l.at))].filter((t) => t !== null);
    return {
      ...p,
      title: partTitle(p),
      lane, laneWords: words,
      now: nowLine(card, p, lane),
      costUsd: cost.usd, costSource: cost.source,
      waitsOn: waitsOn(p, parts),
      dependsOnN: (p.dependsOn ?? []).map((d) => parts.find((x) => x.name === d)?.n).filter((x) => typeof x === 'number'),
      unblocks: unblocks(p, parts),
      stage: card?.stage ?? p.progress?.stage ?? null,
      lastActivityAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    };
  });
  const parentCost = usage?.jobs?.get(view.slug) ?? 0;
  const costUsd = round2(parentCost + enriched.reduce((a, p) => a + p.costUsd, 0));
  const firstLog = log.length ? log[log.length - 1].at : null; // newest first
  const startedAt = view.planApprovedAt ?? firstLog ?? null;
  const times = [ms(log[0]?.at), ...enriched.map((p) => ms(p.lastActivityAt))].filter((t) => t !== null);
  const today = startOfDay(now);
  const mergedToday = log.filter((l) => l.event === 'merged' && (ms(l.at) ?? 0) >= today).length;
  const ask = stackAsk(view);
  // Parts that need you, and the stack itself when its one ask is yours alone (approve, merge, push).
  const needsYou = counts['needs-you'] + counts.stuck + (['merge', 'approve-plan', 'push', 'fix-plan'].includes(ask?.action) ? 1 : 0);
  return {
    ...view,
    parts: enriched,
    counts,
    merged: counts.merged,
    total: parts.length,
    atWork: counts.working + counts.checks + counts.merging,
    needsYou,
    risks: stackRisks(view),
    ask,
    costUsd,
    startedAt,
    lastActivityAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    mergedToday,
  };
}

/** Where a stack sits on the home: needs you first, then working, then done (finished). */
export function stackStanding(v) {
  if (v.phase === 'pushed') return 'done';
  if (v.ask) return 'needs-you';
  return 'working';
}

/**
 * A stack's card on the Stacks home, from its line in GET /api/stacks (lib/stack.js stackSummary,
 * which carries `detail`, the view it came from). The card's fields are added; `detail` goes.
 */
export function stackCard(summary, live = {}) {
  const { detail, ...rest } = summary;
  if (!detail) return rest;
  const v = enrichView(detail, live);
  return {
    ...rest,
    why: v.plan?.why ?? null,
    standing: stackStanding(v),
    approved: v.approved,
    total: v.total,
    merged: v.merged,
    atWorkCount: v.atWork,
    needsYouCount: v.needsYou,
    counts: { ...rest.counts },
    lanes: v.counts,
    segments: v.parts.map((p) => ({ n: p.n, name: p.name, title: p.title, lane: p.lane, laneWords: p.laneWords, slug: p.slug })),
    atWork: v.parts.filter((p) => p.now && ['working', 'checks', 'merging'].includes(p.lane)).map((p) => ({ n: p.n, title: p.title, slug: p.slug, lane: p.lane, ...p.now })),
    ask: v.ask,
    risks: v.risks,
    costUsd: v.costUsd,
    startedAt: v.startedAt,
    lastActivityAt: v.lastActivityAt,
    mergedToday: v.mergedToday,
    nextToMerge: v.nextToMerge ? v.parts.find((p) => p.name === v.nextToMerge)?.n ?? null : null,
    parentBranch: v.parentBranch,
  };
}

// ---------- A part's own page ----------

const ATTEMPT_EVENTS = new Set(['merge-started', 'merged', 'checks-failed', 'conflict', 'outside', 'empty', 'stuck', 'merge-refused', 'started', 'ready', 'sent-back', 'start-failed']);

/** The part's history from the stack's log, newest first: [{ at, event, words, checks? }]. */
export function partHistory(view, name) {
  return (view.log ?? []).filter((l) => l.section === name && ATTEMPT_EVENTS.has(l.event)).map((l) => ({ at: l.at, event: l.event, words: l.words, checks: Array.isArray(l.checks) ? l.checks : null, undone: l.undone ?? null }));
}

/**
 * Ready to merge: a short checklist, each item { id, ok: true | false | null (not yet known), words }.
 */
export function mergeChecklist(view, part) {
  const parts = view.parts ?? [];
  const waits = waitsOn(part, parts);
  const k = part.problem?.kind;
  const merged = part.state === 'integrated';
  const checks = merged || part.state === 'ready' ? true : k === 'checks' || part.state === 'failed' ? false : null;
  return [
    { id: 'checks', ok: checks, words: checks === true ? 'Its checks passed' : checks === false ? `Its checks failed${part.failures ? ` (try ${part.failures} of 3)` : ''}` : 'Its checks haven’t run yet' },
    { id: 'clash', ok: k === 'conflict' ? false : merged || part.state === 'ready' ? true : null, words: k === 'conflict' ? `It clashes with the stack’s branch in ${(part.problem.files ?? []).map(base).slice(0, 2).join(', ') || 'some files'}` : 'No clash with the stack’s branch' },
    { id: 'owned', ok: k === 'outside' ? false : true, words: k === 'outside' ? 'It changed files that aren’t its own' : 'It changed only its own files' },
    { id: 'waits', ok: waits.length === 0, words: waits.length ? `Waiting on ${partsWord(waits)} to merge first` : (part.dependsOn ?? []).length ? 'The parts it waits on are merged' : 'It waits on no other part' },
    { id: 'order', ok: merged ? true : view.nextToMerge === part.name, words: merged ? 'Merged in its turn' : view.nextToMerge === part.name ? 'It is next in the merge order' : `It merges after ${partsWord(parts.filter((p) => p.n < part.n && p.state !== 'integrated').map((p) => p.n).slice(0, 3))}` },
  ];
}

/**
 * A part's own page. view: enrichView's answer. n: its number. extra: { changes, card }. Returns
 * null when there is no such part.
 */
export function partPage(view, n, { changes = null } = {}) {
  const part = (view.parts ?? []).find((p) => p.n === n);
  if (!part) return null;
  const at = view.parts.indexOf(part);
  const pick = (p) => (p ? { n: p.n, name: p.name, title: p.title, lane: p.lane, laneWords: p.laneWords, slug: p.slug } : null);
  return {
    stack: {
      slug: view.slug, title: view.title, ticketKey: view.ticketKey, total: view.total, why: view.plan?.why ?? null,
      parentBranch: view.parentBranch, approved: view.approved, nextToMerge: view.nextToMerge, busy: view.busy, autoIntegrate: view.autoIntegrate,
      parts: view.parts.map(pick),
    },
    part,
    prev: pick(view.parts[at - 1] ?? null),
    next: pick(view.parts[at + 1] ?? null),
    history: partHistory(view, part.name),
    checklist: mergeChecklist(view, part),
    changes,
  };
}

// ---------- Its changes: git, read-only ----------

/** `git diff --numstat` lines → [{ file, added, removed, binary }]. */
export function parseNumstat(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
    if (!m) continue;
    const binary = m[1] === '-' && m[2] === '-';
    out.push({ file: m[3], added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary });
  }
  return out;
}

const diffCache = new Map(); // key (the two heads) → stat

/**
 * A part's changed files against the stack's branch: { files, added, removed, base, branch } or
 * { error } in plain words. git(dir, args) → { code, stdout, stderr } (lib/integrate.js git).
 * Read-only (rev-parse, diff), and cached by the two branches' heads.
 */
export async function diffStat({ git, dir, base: baseBranch, branch, cache = diffCache }) {
  if (!dir || !baseBranch || !branch) return { error: 'This part has no branch yet, so it has no changes to show.', files: [], added: 0, removed: 0 };
  const heads = await git(dir, ['rev-parse', `${baseBranch}^{commit}`, `${branch}^{commit}`]);
  if (heads.code !== 0) return { error: `git couldn’t find ${branch} or ${baseBranch} here.`, files: [], added: 0, removed: 0 };
  const key = `${dir}\u0000${baseBranch}\u0000${branch}\u0000${heads.stdout.trim().replace(/\s+/g, ' ')}`;
  if (cache.has(key)) return cache.get(key);
  const r = await git(dir, ['diff', '--numstat', '--no-renames', `${baseBranch}...${branch}`, '--']);
  if (r.code !== 0) return { error: `git couldn’t compare ${branch} with ${baseBranch}.`, files: [], added: 0, removed: 0 };
  const files = parseNumstat(r.stdout);
  const out = { files, added: files.reduce((a, f) => a + f.added, 0), removed: files.reduce((a, f) => a + f.removed, 0), base: baseBranch, branch };
  cache.set(key, out);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return out;
}

/** The longest diff a page is sent, in characters. */
export const MAX_DIFF = 200_000;

/** One file's diff against the stack's branch: { file, diff, cut } or { error }. Read-only. */
export async function fileDiff({ git, dir, base: baseBranch, branch, file }) {
  if (typeof file !== 'string' || !file || file.length > 500 || file.startsWith('/') || file.split(/[\\/]/).includes('..') || file.startsWith('-')) return { error: 'That isn’t a file in this part.' };
  if (!dir || !baseBranch || !branch) return { error: 'This part has no branch yet.' };
  const r = await git(dir, ['diff', '--no-color', '--no-ext-diff', `${baseBranch}...${branch}`, '--', file]);
  if (r.code !== 0) return { error: `git couldn’t show the changes to ${file}.` };
  const cut = r.stdout.length > MAX_DIFF;
  return { file, diff: cut ? r.stdout.slice(0, MAX_DIFF) : r.stdout, cut };
}
