// Home (the flow map, the Table and the Desk): what each view shows, worked out from the snapshot's
// jobs and permissions and the flow map (GET /api/flow, dashboard/lib/flow.js). Pure: no React.
//
// The map is rows (Light, round 3): one row per job with its ship track (worktree · fork · Moxie
// branch · staging · main), one line of words, the counts as a muted suffix and one "what to do
// next" hint; the rows grouped under Needs you · Running · Idle · Shipping · Done inside each repo's
// section, whose header line is the release train.
import { DEFAULT_FINISH_LINE, type FinishLine, type FlowLane, type FlowPosition, type FlowPr, type FlowRepo, type FlowView, type Job, type Permission } from '../api/types';
import { relativeTime } from '../lib/time';
import { jobStatus } from '../panes/Jobs/jobStatus';
import { stageLabel } from '../panes/Jobs/stages';

export type HomeView = 'map' | 'table' | 'desk';

/** The boxes a lane passes, in order, with their names (a repo without staging stops at main). */
export const POSITION_LABELS: Record<FlowPosition, string> = {
  local: 'Your worktree',
  fork: 'Your fork',
  org: 'Moxie branch',
  staging: 'Staging',
  main: 'Main',
};

/** The five stops of the ship track, in the order the work travels. */
export const STOPS: readonly FlowPosition[] = ['local', 'fork', 'org', 'staging', 'main'];

type RepoShape = Pick<FlowRepo, 'org' | 'staging'> | null | undefined;

/** A repo with no org remote or no staging branch has the short track: worktree → fork → main. No repo given: the full track. */
export const simpleRepo = (repo: RepoShape): boolean => repo != null && (!repo.org || !repo.staging);

/** The stops a repo's track draws. */
export function trackStops(repo: RepoShape): FlowPosition[] {
  return simpleRepo(repo) ? ['local', 'fork', 'main'] : [...STOPS];
}

/**
 * The stop the finish-line flag stands on: PR #1 open or merged → the Moxie branch, staging →
 * staging, main → main, "when I mark it" → none. On the short track the Moxie branch is main.
 */
export function finishStop(setting: FinishLine | null | undefined, repo?: RepoShape): FlowPosition | null {
  const rule = setting ?? DEFAULT_FINISH_LINE;
  const stop: FlowPosition | null = rule === 'marked' ? null : rule === 'staging' ? 'staging' : rule === 'main' ? 'main' : 'org';
  if (stop === 'org' && simpleRepo(repo)) return 'main';
  return stop;
}

/** Where a job's work is, in a few words: "On your fork", "In staging". */
export function whereText(lane: FlowLane | null | undefined, repo?: RepoShape): string {
  if (!lane) return 'Not on the map';
  switch (lane.position) {
    case 'local': return lane.branch ? 'Only on your machine' : 'No branch yet';
    case 'fork': return 'On your fork';
    case 'org': return `On the ${repo?.org?.remote ?? 'org'} branch`;
    case 'staging': return 'In staging';
    case 'main': return 'Released to main';
    default: return '';
  }
}

const live = (pr: FlowPr | null | undefined): pr is FlowPr => pr?.state === 'open' || pr?.state === 'draft';

/** A PR in a few words: "#135 merged", "#141 open · checks failing", "#150 draft". */
export function prText(pr: FlowPr | null | undefined): string {
  if (!pr) return 'No PR yet';
  return [`#${pr.number} ${pr.state}`, ...prFacts(pr)].join(' · ');
}

/** What an open PR is doing, without its number: ['checks failing', 'review needed']. */
function prFacts(pr: FlowPr): string[] {
  const parts: string[] = [];
  if (!live(pr)) return parts;
  if (pr.checks === 'failing') parts.push('checks failing');
  else if (pr.checks === 'pending') parts.push('checks running');
  if (pr.review === 'approved') parts.push('approved');
  else if (pr.review === 'changes_requested') parts.push('changes requested');
  else if (pr.review === 'review_required') parts.push('review needed');
  return parts;
}

/** A PR's state as the row's words say it: "open, checks failing", "merged", "draft, review needed". */
export function prPhrase(pr: FlowPr): string {
  return [pr.state, ...prFacts(pr)].join(', ');
}

/** The tone a PR's chip takes: merged, problem (failing checks or changes asked), open, closed. */
export function prTone(pr: FlowPr | null | undefined): 'none' | 'merged' | 'problem' | 'open' | 'closed' {
  if (!pr) return 'none';
  if (pr.state === 'merged') return 'merged';
  if (pr.state === 'closed') return 'closed';
  return pr.checks === 'failing' || pr.review === 'changes_requested' ? 'problem' : 'open';
}

/** "↑3 ↓5": commits ahead of and behind a branch, for a chip; '' when unknown. */
export function countsText(c: { ahead: number; behind: number } | null | undefined): string {
  return c ? `↑${c.ahead} ↓${c.behind}` : '';
}

/** The same in words, for hover hints and screen readers. */
export function countsWords(c: { ahead: number; behind: number } | null | undefined, of: string): string {
  if (!c) return `Not compared with ${of} yet.`;
  const a = c.ahead === 1 ? '1 commit' : `${c.ahead} commits`;
  const b = c.behind === 1 ? '1 commit' : `${c.behind} commits`;
  return `${a} ahead of ${of}, ${b} behind it.${c.behind > 0 ? ` ${of} has moved on since this branch started: bring it in before the next push.` : ''}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The muted suffix on a row's words: "main ↑3 ↓0 · 2 not pushed · 3 uncommitted"; '' with nothing to say. */
export function countsSuffix(lane: FlowLane | null | undefined): string {
  if (!lane) return '';
  const parts: string[] = [];
  if (lane.vsMain) parts.push(`main ${countsText(lane.vsMain)}`);
  if (lane.unpushed) parts.push(`${lane.unpushed} not pushed`);
  if (lane.dirty) parts.push(`${lane.dirty} uncommitted`);
  return parts.join(' · ');
}

/** The PR the row talks about: the one still open, else the latest; with its name ("PR #1", or "PR" on the short track). */
export function activePr(lane: FlowLane, repo?: RepoShape): { label: string; pr: FlowPr } | null {
  if (simpleRepo(repo)) return lane.pr2 ? { label: 'PR', pr: lane.pr2 } : lane.pr1 ? { label: 'PR', pr: lane.pr1 } : null;
  if (live(lane.pr1) && !live(lane.pr2)) return { label: 'PR #1', pr: lane.pr1 };
  if (lane.pr2) return { label: 'PR #2', pr: lane.pr2 };
  return lane.pr1 ? { label: 'PR #1', pr: lane.pr1 } : null;
}

/** The newest PR of a lane, for `o`: the open one, else the latest. */
export const newestPr = (lane: FlowLane | null | undefined, repo?: RepoShape): FlowPr | null => (lane ? activePr(lane, repo)?.pr ?? null : null);

/**
 * The row's words, as one line: "On your fork · PR #1 (#141) open, checks failing". The same words
 * the Table's Where column uses. The map renders the PR part as a link to GitHub.
 */
export function whereLine(lane: FlowLane | null | undefined, repo?: RepoShape): string {
  if (!lane) return '';
  const where = whereText(lane, repo);
  const pr = activePr(lane, repo);
  return pr ? `${where} · ${pr.label} (#${pr.pr.number}) ${prPhrase(pr.pr)}` : where;
}

/**
 * One plain sentence on what to do next, from the facts: the Foreman's ask first, then the
 * track's. '' when there is nothing to say.
 */
export function nextHint(lane: FlowLane | null, job: Job | null, ctx: { repo?: RepoShape; release?: FlowPr | null; now?: Date } = {}): string {
  const now = ctx.now ?? new Date();
  if (job) {
    const st = jobStatus(job, now);
    switch (job.group) {
      case 'needs-you':
        if ((job.permissions ?? 0) > 0 || job.waitingFor === 'permission') return 'Allow or deny a permission';
        if (job.waitingFor === 'answers') return 'Answer the Foreman’s questions';
        if (job.waitingFor === 'approval') return `Give the go-ahead${job.stage ? ` on ${stageLabel(job.stage)}` : ''}`;
        return 'Reply to the Foreman';
      case 'running':
        return 'Nothing to do: the Foreman is working';
      case 'paused':
        return st.label === 'Paused' ? 'Paused by the usage limit' : `Paused: ${st.label}`;
      case 'done':
        if (job.finish?.landed === 'main' || lane?.position === 'main') return 'In main';
        return st.label === 'Dropped' ? 'Dropped' : 'Marked done';
      default:
        break;
    }
  }
  if (!lane) return '';
  const simple = simpleRepo(ctx.repo);
  const since = (pr: FlowPr) => { const t = relativeTime(pr.updatedAt, now); return t && t !== 'just now' ? ` · ${t}` : ''; };
  // PR #1 is yours to self-review and merge; PR #2 (and the one PR of the short track) waits for a review.
  const prHint = (label: string, pr: FlowPr) => {
    const s = pr.checks === 'failing' ? `${label} checks failing`
      : pr.review === 'changes_requested' ? `${label}: changes requested`
      : pr.state === 'draft' ? `${label} is a draft: mark it ready`
      : pr.checks === 'pending' ? `${label} checks running`
      : label === 'PR #1' || pr.review === 'approved' ? `Merge ${label} on GitHub`
      : `Waiting for a review on ${label}${since(pr)}`;
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  switch (lane.position) {
    case 'main': return 'Landed in main';
    case 'staging': return ctx.release ? `Waiting for the release · #${ctx.release.number} ${ctx.release.state}` : 'Nothing to do: waiting for the release';
    default: break;
  }
  if (live(lane.pr2)) return prHint(simple ? 'the PR' : 'PR #2', lane.pr2);
  if (live(lane.pr1)) return prHint(simple ? 'the PR' : 'PR #1', lane.pr1);
  if (lane.position === 'org') return 'Open PR #2';
  if (!lane.branch) return 'No branch yet';
  if (lane.dirty) return `Commit ${plural(lane.dirty, 'changed file')}`;
  if (lane.vsMain && lane.vsMain.behind > 0) return `Bring main in: it moved ${plural(lane.vsMain.behind, 'commit')}`;
  if (lane.unpushed) return `Push ${plural(lane.unpushed, 'commit')}`;
  if (lane.position === 'fork') return simple ? 'Open the PR' : 'Open PR #1';
  if (lane.vsMain && lane.vsMain.ahead === 0) return 'Nothing to push yet';
  return 'Push the branch';
}

// ---------- the repo header: the release train ----------

export interface ReleaseLine {
  /** "staging: 14 commits waiting" */
  staging: string | null;
  /** "release #158 open", with the PR for the link. */
  release: { text: string; pr: FlowPr } | null;
  /** "last release 2026-10-20 (#139)" */
  last: string | null;
}

/** The repo header's release train, in parts; each is null when the map doesn't have it. */
export function releaseLine(repo: FlowRepo): ReleaseLine {
  const ahead = repo.staging?.vsMain?.ahead;
  const staging = typeof ahead === 'number' ? `staging: ${plural(ahead, 'commit')} waiting` : null;
  const release = repo.release ? { text: `release #${repo.release.number} ${repo.release.state}`, pr: repo.release } : null;
  const tip = repo.main?.tip;
  let last: string | null = null;
  if (tip) {
    const n = /#(\d+)/.exec(tip.subject)?.[1];
    last = `last release ${tip.at.slice(0, 10)}${n ? ` (#${n})` : ''}`;
  }
  return { staging, release, last };
}

/** The same as one line: "staging: 14 commits waiting · release #158 open · last release 2026-10-20 (#139)". */
export function releaseLineText(repo: FlowRepo): string {
  const r = releaseLine(repo);
  return [r.staging, r.release?.text ?? null, r.last].filter((x): x is string => Boolean(x)).join(' · ');
}

// ---------- the rows ----------

export type MapFilter = 'open' | 'all';

export interface MapLane { lane: FlowLane; job: Job | null }
export interface MapRepo { repo: FlowRepo; lanes: MapLane[] }

const GROUP_RANK: Record<string, number> = { 'needs-you': 0, running: 1, paused: 2, idle: 3, shipping: 4, done: 5 };

/**
 * The map's repos and lanes. open: the jobs still open (a job in main stays, under Done, until
 * you mark it); all: also the jobs marked done or dropped the map still knows (closed in the last
 * 30 days). Lanes follow the Jobs list's order: needs you first.
 */
export function mapRepos(flow: FlowView | null, jobs: readonly Job[], filter: MapFilter = 'open'): MapRepo[] {
  if (!flow?.repos) return [];
  const bySlug = new Map(jobs.map((j, i) => [j.slug, { j, i }]));
  return flow.repos
    .map((repo) => ({
      repo,
      lanes: repo.lanes
        .map((lane) => ({ lane, job: bySlug.get(lane.slug)?.j ?? null, i: bySlug.get(lane.slug)?.i ?? 9999 }))
        .filter(({ job }) => filter === 'all' || (job !== null && !job.closed))
        .sort((a, b) => (GROUP_RANK[a.job?.group ?? 'done'] ?? 9) - (GROUP_RANK[b.job?.group ?? 'done'] ?? 9) || a.i - b.i)
        .map(({ lane, job }) => ({ lane, job })),
    }))
    .filter((r) => r.lanes.length > 0);
}

/** The rows' headings, in order. Paused rows sit under Idle; a lane without a job under Done. */
export type MapGroup = 'needs-you' | 'running' | 'idle' | 'shipping' | 'done';
export const MAP_GROUPS: readonly MapGroup[] = ['needs-you', 'running', 'idle', 'shipping', 'done'];
export const MAP_GROUP_LABELS: Record<MapGroup, string> = { 'needs-you': 'Needs you', running: 'Running', idle: 'Idle', shipping: 'Shipping', done: 'Done' };

export function mapGroupOf(job: Job | null): MapGroup {
  if (!job) return 'done';
  return job.group === 'paused' ? 'idle' : job.group;
}

/** A repo's lanes under their headings, empty headings left out. */
export function groupLanes(lanes: readonly MapLane[]): { group: MapGroup; label: string; lanes: MapLane[] }[] {
  return MAP_GROUPS
    .map((group) => ({ group, label: MAP_GROUP_LABELS[group], lanes: lanes.filter((l) => mapGroupOf(l.job) === group) }))
    .filter((g) => g.lanes.length > 0);
}

// ---------- the filter chips ----------

/** All · Needs you · Shipping · one chip per repo (when there is more than one). */
export type MapChip = 'all' | 'needs-you' | 'shipping' | `repo:${string}`;

export interface MapChipDef { id: MapChip; label: string; count: number; hint: string }

const laneMatches = (l: MapLane, repo: FlowRepo, chip: MapChip): boolean => {
  if (chip === 'all') return true;
  if (chip === 'needs-you') return l.job?.group === 'needs-you';
  if (chip === 'shipping') return l.job?.group === 'shipping';
  return `repo:${repo.name}` === chip;
};

/** The chips with their counts, from the repos the open/all filter left. */
export function mapChips(repos: readonly MapRepo[]): MapChipDef[] {
  const count = (chip: MapChip) => repos.reduce((n, r) => n + r.lanes.filter((l) => laneMatches(l, r.repo, chip)).length, 0);
  const chips: MapChipDef[] = [
    { id: 'all', label: 'All', count: count('all'), hint: 'Every job on the map.' },
    { id: 'needs-you', label: 'Needs you', count: count('needs-you'), hint: 'Jobs waiting for your go-ahead, an answer or a click.' },
    { id: 'shipping', label: 'Shipping', count: count('shipping'), hint: 'Jobs past the finish line you set, on their way to main.' },
  ];
  if (repos.length > 1) for (const r of repos) chips.push({ id: `repo:${r.repo.name}`, label: r.repo.name, count: r.lanes.length, hint: `Only the jobs in ${r.repo.name}.` });
  return chips;
}

/** The repos and lanes a chip leaves; repos left empty go. */
export function filterRepos(repos: readonly MapRepo[], chip: MapChip): MapRepo[] {
  return repos
    .map((r) => ({ repo: r.repo, lanes: r.lanes.filter((l) => laneMatches(l, r.repo, chip)) }))
    .filter((r) => r.lanes.length > 0);
}

/** The chip remembered in this browser, or All when it is unknown or its repo is gone. */
export function knownChip(raw: string | null, chips: readonly MapChipDef[]): MapChip {
  return chips.some((c) => c.id === raw) ? (raw as MapChip) : 'all';
}

// ---------- the Table ----------

export type TableFilter = 'all' | 'needs-you' | 'running' | 'idle' | 'review' | 'shipping' | 'done';
export type SortKey = 'job' | 'repo' | 'level' | 'stage' | 'status' | 'where' | 'main' | 'updated';

export interface TableRow {
  slug: string;
  title: string;
  repo: string;
  branch: string;
  level: number | null;
  stage: string;
  stageId: string;
  group: Job['group'];
  status: string;
  statusHint: string;
  where: string;
  reached: number;
  vsMain: { ahead: number; behind: number } | null;
  pr1: FlowPr | null;
  pr2: FlowPr | null;
  updatedAt: string | null;
  /** An open PR (in review on GitHub). */
  inReview: boolean;
}

export function tableRows(jobs: readonly Job[], flow: FlowView | null, now: Date = new Date()): TableRow[] {
  const lanes = new Map<string, { lane: FlowLane; repo: FlowRepo }>();
  for (const repo of flow?.repos ?? []) for (const lane of repo.lanes) lanes.set(lane.slug, { lane, repo });
  return jobs.map((j) => {
    const hit = lanes.get(j.slug);
    const st = jobStatus(j, now);
    const pr1 = hit?.lane.pr1 ?? null;
    const pr2 = hit?.lane.pr2 ?? null;
    const open = (p: FlowPr | null) => p?.state === 'open' || p?.state === 'draft';
    return {
      slug: j.slug, title: j.title || j.slug,
      repo: hit?.repo.name ?? (j.project as { name?: string } | undefined)?.name ?? '',
      branch: hit?.lane.branch ?? (j.repo as { branch?: string } | null | undefined)?.branch ?? '',
      level: typeof j.level === 'number' ? j.level : null,
      stage: j.stage ? stageLabel(j.stage) : '', stageId: j.stage ?? '',
      group: j.group, status: st.label, statusHint: st.hint,
      where: hit ? whereLine(hit.lane, hit.repo) : '', reached: hit?.lane.reached ?? -1,
      vsMain: hit?.lane.vsMain ?? null, pr1, pr2,
      updatedAt: typeof j.updatedAt === 'string' ? j.updatedAt : null,
      inReview: open(pr1) || open(pr2),
    };
  });
}

export function filterRows(rows: readonly TableRow[], filter: TableFilter, query = ''): TableRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter === 'review' ? !r.inReview : filter !== 'all' && r.group !== filter) return false;
    if (!q) return true;
    return [r.title, r.slug, r.repo, r.branch, r.stage, r.status].some((x) => x.toLowerCase().includes(q));
  });
}

const STATUS_RANK: Record<string, number> = GROUP_RANK;

export function sortRows(rows: readonly TableRow[], key: SortKey, dir: 'asc' | 'desc'): TableRow[] {
  const val = (r: TableRow): string | number => {
    switch (key) {
      case 'job': return r.title.toLowerCase();
      case 'repo': return r.repo.toLowerCase();
      case 'level': return r.level ?? 99;
      case 'stage': return r.stage.toLowerCase();
      case 'status': return STATUS_RANK[r.group] ?? 9;
      case 'where': return r.reached;
      case 'main': return r.vsMain ? r.vsMain.behind * 1000 + r.vsMain.ahead : -1;
      case 'updated': return r.updatedAt ? Date.parse(r.updatedAt) : 0;
      default: return 0;
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign || a.title.localeCompare(b.title);
  });
}

// ---------- the Desk ----------

export type DeskItem =
  | { kind: 'gate'; key: string; slug: string; title: string; what: string; since: string | null; waitingFor: string }
  | { kind: 'permission' | 'question'; key: string; slug: string; title: string; what: string; since: string | null; permission: Permission };

/**
 * Every decision waiting for you, oldest first: each job waiting for a go-ahead, an answer or a
 * reply (one item per job), and each permission or question card.
 */
export function deskQueue(jobs: readonly Job[], permissions: readonly Permission[]): DeskItem[] {
  const items: DeskItem[] = [];
  for (const j of jobs) {
    if (j.group !== 'needs-you' || j.waitingFor === 'permission' || !j.waitingFor) continue;
    const what = j.waitingFor === 'answers' ? 'Answer the Foreman’s questions' : j.waitingFor === 'approval' ? `Go-ahead${j.stage ? ` on ${stageLabel(j.stage)}` : ''}` : 'Reply to the Foreman';
    items.push({ kind: 'gate', key: `gate:${j.slug}`, slug: j.slug, title: j.title || j.slug, what, since: typeof j.waitingSince === 'string' ? j.waitingSince : null, waitingFor: j.waitingFor });
  }
  for (const p of permissions) {
    const job = jobs.find((j) => j.slug === p.slug);
    const kind = p.kind === 'question' ? 'question' : 'permission';
    items.push({
      kind, key: `perm:${p.id}`, slug: p.slug, title: job?.title || p.title || p.slug,
      what: kind === 'question' ? 'A question from the crew' : p.plain?.headline || `Use ${p.toolName}`,
      since: p.createdAt ?? null, permission: p,
    });
  }
  const t = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Number.POSITIVE_INFINITY);
  return items.sort((a, b) => t(a.since) - t(b.since));
}

/**
 * Whether a Desk item may be approved with one key: a go-ahead with no questions, or a permission
 * that is neither a hard line nor flagged risky. Never the Foreman's questions (a recommended answer
 * still has to be read), nor a crew question. DeskView also checks the card itself for questions.
 */
export function oneKeyApprove(item: DeskItem): boolean {
  if (item.kind === 'gate') return item.waitingFor === 'approval';
  if (item.kind === 'question') return false;
  return !item.permission.hardLine && !item.permission.defaultToNo;
}
