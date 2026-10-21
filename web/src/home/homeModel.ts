// Home (the flow map, the Table and the Desk): what each view shows, worked out from the snapshot's
// jobs and permissions and the flow map (GET /api/flow, dashboard/lib/flow.js). Pure: no React.
import type { FlowLane, FlowPosition, FlowPr, FlowRepo, FlowView, Job, Permission } from '../api/types';
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

/** Where a job's work is, in a few words: "On your fork", "In staging". */
export function whereText(lane: FlowLane | null | undefined, repo?: Pick<FlowRepo, 'org' | 'staging'> | null): string {
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

/** A PR in a few words: "#135 merged", "#141 open · checks failing", "#150 draft". */
export function prText(pr: FlowPr | null | undefined): string {
  if (!pr) return 'No PR yet';
  const parts = [`#${pr.number} ${pr.state}`];
  if (pr.state === 'open' || pr.state === 'draft') {
    if (pr.checks === 'failing') parts.push('checks failing');
    else if (pr.checks === 'pending') parts.push('checks running');
    if (pr.review === 'approved') parts.push('approved');
    else if (pr.review === 'changes_requested') parts.push('changes requested');
    else if (pr.review === 'review_required') parts.push('review needed');
  }
  return parts.join(' · ');
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

export type MapFilter = 'open' | 'all';

export interface MapLane { lane: FlowLane; job: Job | null }
export interface MapRepo { repo: FlowRepo; lanes: MapLane[] }

const GROUP_RANK: Record<string, number> = { 'needs-you': 0, running: 1, paused: 2, idle: 3, done: 4 };

/**
 * The map's repos and lanes. open: only jobs not done; all: the closed ones the map still knows
 * (closed in the last 30 days). Lanes follow the Jobs list's order: needs you first.
 */
export function mapRepos(flow: FlowView | null, jobs: readonly Job[], filter: MapFilter = 'open'): MapRepo[] {
  if (!flow) return [];
  const bySlug = new Map(jobs.map((j, i) => [j.slug, { j, i }]));
  return flow.repos
    .map((repo) => ({
      repo,
      lanes: repo.lanes
        .map((lane) => ({ lane, job: bySlug.get(lane.slug)?.j ?? null, i: bySlug.get(lane.slug)?.i ?? 9999 }))
        .filter(({ job }) => filter === 'all' || (job !== null && job.group !== 'done'))
        .sort((a, b) => (GROUP_RANK[a.job?.group ?? 'done'] ?? 9) - (GROUP_RANK[b.job?.group ?? 'done'] ?? 9) || a.i - b.i)
        .map(({ lane, job }) => ({ lane, job })),
    }))
    .filter((r) => r.lanes.length > 0);
}

// ---------- the Table ----------

export type TableFilter = 'all' | 'needs-you' | 'running' | 'idle' | 'review' | 'done';
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
      where: hit ? whereText(hit.lane, hit.repo) : '', reached: hit?.lane.reached ?? -1,
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
