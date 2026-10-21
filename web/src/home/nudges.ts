// The Desk's hand-off nudges (plan §2 C) and its session log. Pure, except the small store at the
// end (what you decided this session, kept in memory until the page is reloaded).
//
// A nudge comes on a job card (`nudges`, dashboard/lib/nudges.js): one PR step that waits on you
// ("Self-review and merge PR #1 on GitHub", a link) or that the Foreman takes on when you say yes
// ("Open PR #2 to staging?"). Here each becomes a Desk item after the gate, permission and
// question items (homeModel.ts deskQueue): the ones before your finish line first, then, under a
// quieter Shipping heading, the ones on jobs already past it.
import { useSyncExternalStore } from 'react';
import type { Job, Nudge } from '../api/types';
import { GROUP_LABELS } from '../panes/Jobs/jobStatus';
import { stageLabel } from '../panes/Jobs/stages';
import { formatCost } from '../panes/Foreman/thread';
import { type DeskItem, oneKeyApprove } from './homeModel';

export interface NudgeItem {
  kind: 'nudge';
  key: string;
  slug: string;
  title: string;
  what: string;
  since: string | null;
  nudge: Nudge;
}

/** Everything the Desk lists: the decisions homeModel.ts queues, and the nudges. */
export type DeskEntry = DeskItem | NudgeItem;

const t = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : Number.POSITIVE_INFINITY);

/** Every job's nudges as Desk items, oldest first (by when the job crossed the line, else its last change). */
export function nudgeItems(jobs: readonly Job[]): NudgeItem[] {
  const items: NudgeItem[] = [];
  for (const j of jobs) {
    for (const n of j.nudges ?? []) {
      const since = j.finish?.at ?? (typeof j.updatedAt === 'string' ? j.updatedAt : null);
      items.push({ kind: 'nudge', key: `nudge:${j.slug}:${n.id}`, slug: j.slug, title: j.title || j.slug, what: n.title, since, nudge: n });
    }
  }
  return items.sort((a, b) => t(a.since) - t(b.since));
}

/** The Desk's queue: the decisions, then the nudges before the finish line, then those after it (Shipping). */
export function deskEntries(items: readonly DeskItem[], jobs: readonly Job[]): DeskEntry[] {
  const nudges = nudgeItems(jobs);
  return [...items, ...nudges.filter((n) => !n.nudge.afterLine), ...nudges.filter((n) => n.nudge.afterLine)];
}

/** A nudge on a job past your finish line: listed under Shipping. */
export const isShipping = (e: DeskEntry): boolean => e.kind === 'nudge' && e.nudge.afterLine;

/** Whether `a` decides this item: a nudge the Foreman can take on; else as homeModel.ts says. */
export function oneKeyDecide(item: DeskEntry): boolean {
  return item.kind === 'nudge' ? item.nudge.action !== null : oneKeyApprove(item);
}

/** POST here to say yes to a nudge, or to put it away. */
export const nudgePath = (slug: string, id: string, what: 'yes' | 'dismiss') => `/api/job/${encodeURIComponent(slug)}/nudge/${encodeURIComponent(id)}/${what}`;

// ---------- The job's facts and where its work is ----------

/** The job's facts for the Desk's side column: status, kind, level, repo, branch, cost (over 10 cents). */
export function jobFacts(job: Job): string[] {
  const out: string[] = [GROUP_LABELS[job.group] ?? job.group];
  if (job.kind) out.push(job.kind === 'bug' ? 'Bug fix' : job.kind === 'feature' ? 'Feature' : job.kind);
  if (typeof job.level === 'number') out.push(`L${job.level}`);
  if (job.repo?.name) out.push(job.repo.name);
  if (job.repo?.branch) out.push(job.repo.branch);
  const cost = job.cost?.totalUsd ?? 0;
  if (job.cost?.source !== 'none' && cost > 0.1) out.push(formatCost(cost));
  return out;
}

/** One line on where the work is: from the finish line when it says, else the branch and the stage. */
export function whereLine(job: Job): string {
  const f = job.finish;
  if (f?.landed === 'main') return 'Released to main';
  if (f?.landed === 'staging') return 'In staging, waiting for the release';
  if (f?.reached && f.by === 'pr1-merged') return 'On the Moxie branch';
  if (f?.reached && f.by === 'pr1-open') return 'PR #1 open from your fork';
  if (f?.reached && f.by === 'marked') return 'Marked done';
  const stage = job.stage ? stageLabel(job.stage) : '';
  const branch = job.repo?.branch ?? null;
  if (branch && stage) return `${branch} · ${stage}`;
  return branch || stage || 'No branch yet';
}

// ---------- Decided today: what you decided this session, newest first ----------

export interface Decision { title: string; what: string; at: string }

let decisions: readonly Decision[] = [];
const listeners = new Set<() => void>();
const MAX = 50;

/** Remember a decision you just made on the Desk (the item's title, what you did). */
export function recordDecision(d: { title: string; what: string; at?: string }) {
  decisions = [{ title: d.title, what: d.what, at: d.at ?? new Date().toISOString() }, ...decisions].slice(0, MAX);
  for (const l of [...listeners]) l();
}

/** Forget them (tests). */
export function clearDecisions() {
  decisions = [];
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The decisions made this session, newest first. */
export function useDecidedToday(): readonly Decision[] {
  return useSyncExternalStore(subscribe, () => decisions, () => decisions);
}
