// What ⌘K lists: only the actions that make sense right now (design doc section 2), worked out
// from the store, the open job and what its Foreman pane knows. Pure, so it's easy to test; the
// palette (components/CommandPalette.tsx) shows them and runs the one you pick.
import type { Job, PolicyId } from '../api/types';
import { autoBlockedReason, autoModeOf, POLICIES, policyLabel } from '../components/permissions/policies';
import { isActiveRun } from '../panes/Foreman/thread';
import { GROUP_LABELS } from '../panes/Jobs/jobStatus';
import { jobsByGroup, jobBySlug, type WorkshopState } from '../state/reducer';
import { JOB_GROUPS } from '../api/types';
import type { CurrentJob } from './ui';

export type CommandSection = 'This job' | 'Jobs' | 'Go to';

export interface Command {
  id: string;
  label: string;
  /** The hover hint, and what a screen reader hears after the label. */
  hint: string;
  section: CommandSection;
  /** The key that does the same outside ⌘K, when there is one. */
  keys?: string;
  /** Extra words the search matches. */
  keywords?: string;
  run: () => void;
}

/** What each command does when picked (the shell wires these to the dashboard and the router). */
export interface CommandHandlers {
  openJob(slug: string): void;
  newJob(): void;
  stop(runId: string): void;
  focusComposer(): void;
  markDone(slug: string): void;
  reopen(slug: string): void;
  /** Open the job drawer: the job's notes and options. */
  jobDrawer(slug: string): void;
  setPolicy(slug: string, policy: PolicyId | null): void;
  settings(): void;
  /** Open a page of the classic view (decision D4). */
  classic(href: string): void;
  showKeys(): void;
}

export interface CommandContext {
  state: WorkshopState;
  /** The job open in the Foreman pane, if any. */
  slug: string | null;
  /** What the open job's pane knows (its reply in progress); null until it has loaded. */
  current: CurrentJob | null;
  onSettings: boolean;
  classic: { home(): string; job(slug: string): string; costs(): string; history(): string };
}

/** Every job in Jobs-pane order (Needs you first), as j and k step through them. */
export function jobsInOrder(state: WorkshopState): Job[] {
  const groups = jobsByGroup(state);
  return JOB_GROUPS.flatMap((g) => groups[g]);
}

function jobCommands(ctx: CommandContext, h: CommandHandlers, job: Job): Command[] {
  const out: Command[] = [];
  const current = ctx.current?.slug === job.slug ? ctx.current : null;
  const run = current?.run ?? ctx.state.runs[job.slug] ?? null;
  const running = isActiveRun(run);
  const title = job.title || job.slug;

  if (running) {
    if (run.status !== 'stopping') {
      out.push({
        id: 'stop', label: 'Stop the reply', section: 'This job', keywords: 'interrupt pause end halt',
        hint: 'End the Foreman’s reply now. Anything waiting for your answer is declined, your draft is kept, and the job waits for your next message.',
        run: () => h.stop(run.id),
      });
    }
    out.push({
      id: 'steer', label: 'Steer the reply in progress', section: 'This job', keywords: 'message write composer',
      hint: 'Jump to the message box: what you write joins the reply in progress.',
      run: h.focusComposer,
    });
  } else {
    out.push({
      id: 'write', label: 'Write to the Foreman', section: 'This job', keywords: 'message send composer',
      hint: 'Jump to the message box at the foot of the conversation.',
      run: h.focusComposer,
    });
  }

  if (job.closed || job.closedEarlier) {
    out.push({
      id: 'reopen', label: job.closed ? 'Reopen this job' : 'Keep this job open', section: 'This job', keywords: 'undo done dropped',
      hint: job.closed
        ? 'Put it back among the open jobs. Nothing else changes; the Foreman isn’t contacted.'
        : 'It was marked done or dropped earlier and has changed since. Keep it open for good.',
      run: () => h.reopen(job.slug),
    });
  }
  if (!job.closed && !running) {
    out.push({
      id: 'mark-done', label: 'Mark done or dropped…', section: 'This job', keywords: 'close finish drop archive',
      hint: 'Move it to Done. Nothing is deleted and you can reopen it any time.',
      run: () => h.markDone(job.slug),
    });
  }

  // This job's own permission setting: every choice except the one in force for it already.
  const settings = ctx.state.meta?.settings;
  const dir = current?.dir;
  const override = dir && settings?.jobPolicy ? settings.jobPolicy[dir] ?? null : current?.policyOverride ?? null;
  const blocked = autoBlockedReason(autoModeOf(settings));
  if (current) {
    if (override !== null) {
      out.push({
        id: 'policy-follow', label: `Permissions for this job: follow my setting (${policyLabel(settings?.policy)})`, section: 'This job', keywords: 'permission policy',
        hint: 'Drop this job’s own setting, so it uses your global one from Settings.',
        run: () => h.setPolicy(job.slug, null),
      });
    }
    for (const p of POLICIES) {
      if (p.id === override || (p.id === 'auto' && blocked)) continue;
      out.push({
        id: `policy-${p.id}`, label: `Permissions for this job: ${p.label}`, section: 'This job', keywords: 'permission policy',
        hint: `${p.hint} Only this job; it applies at once, also to a reply in progress.`,
        run: () => h.setPolicy(job.slug, p.id),
      });
    }
  }

  out.push({
    id: 'job-drawer', label: 'Job notes and options', section: 'This job', keywords: 'notes options settings level flow stages skip reviewers models fable',
    hint: `Open ${title}’s notes (notes.md, read by the Foreman every session) and its options: level, stages, reviewers, testing, Fable, models.`,
    run: () => h.jobDrawer(job.slug),
  });
  out.push({
    id: 'classic-job', label: 'Open this job in classic view', section: 'This job', keywords: 'details costs try local',
    hint: 'Its classic page: try it on your computer, details, costs and provided documents.',
    run: () => h.classic(ctx.classic.job(job.slug)),
  });
  return out;
}

export function commandsFor(ctx: CommandContext, h: CommandHandlers): Command[] {
  const { state } = ctx;
  const out: Command[] = [];
  const job = jobBySlug(state, ctx.slug);
  if (job) out.push(...jobCommands(ctx, h, job));

  if (state.status === 'ready') {
    out.push({
      id: 'new-job', label: 'New job…', section: 'Jobs', keys: 'c', keywords: 'start create',
      hint: 'Start a job: describe it, pick the repository, kind and Foreman model.',
      run: h.newJob,
    });
    for (const j of jobsInOrder(state)) {
      if (j.slug === ctx.slug) continue;
      out.push({
        id: `open:${j.slug}`, label: `Open ${j.title || j.slug}`, section: 'Jobs', keywords: `job ${j.slug} ${GROUP_LABELS[j.group] ?? ''}`,
        hint: `${GROUP_LABELS[j.group] ?? j.group}. Show its conversation with the Foreman.`,
        run: () => h.openJob(j.slug),
      });
    }
  }

  if (!ctx.onSettings) {
    out.push({ id: 'settings', label: 'Settings', section: 'Go to', keywords: 'permissions rules always allow', hint: 'Your permission setting and your “Always allow” rules.', run: h.settings });
  }
  out.push(
    { id: 'classic-home', label: 'Classic view', section: 'Go to', keywords: 'old board', hint: 'Open the classic Feature Workshop page.', run: () => h.classic(ctx.classic.home()) },
    { id: 'classic-costs', label: 'Costs (classic view)', section: 'Go to', keywords: 'spend money', hint: 'What your jobs have cost, on the classic Costs page.', run: () => h.classic(ctx.classic.costs()) },
    { id: 'classic-history', label: 'History search (classic view)', section: 'Go to', keywords: 'past conversations', hint: 'Search your past Claude conversations on the classic History page.', run: () => h.classic(ctx.classic.history()) },
    { id: 'keys', label: 'Keyboard shortcuts', section: 'Go to', keys: '?', keywords: 'help keys', hint: 'List the keys that work on this page.', run: h.showKeys },
  );
  return out;
}

/** The commands matching what you typed: every word must appear in the label or its keywords. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return commands;
  return commands.filter((c) => {
    const text = `${c.label} ${c.keywords ?? ''} ${c.section}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
