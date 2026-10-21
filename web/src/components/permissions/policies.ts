// The three permission settings, in plain words, for Settings and the job menu. The dashboard's
// side: dashboard/lib/policy.js (POLICIES), lib/driver.js (auto mode) and lib/hard-lines.js.
import type { AutoModeStatus, PolicyId, Settings } from '../../api/types';

export interface PolicyInfo {
  id: PolicyId;
  label: string;
  /** One line under the choice. */
  note: string;
  /** The hover hint. */
  hint: string;
}

export const HARD_LINES_NOTE = 'Pushes, pull requests, rm -rf and database migrations ask you, and pushes to the org repo or force pushes are refused, whichever you pick. In auto mode your go-ahead covers some: pushing and opening the PR once you approve the PR stage, and rm -rf inside the job’s own folders. Merges and database changes always ask.';

export const POLICIES: PolicyInfo[] = [
  {
    id: 'ask-all',
    label: 'Ask about everything',
    note: 'Every step that needs permission comes to you as a card.',
    hint: 'You approve every step yourself. Slowest, and you see everything.',
  },
  {
    id: 'hands-off',
    label: 'Routine steps automatic',
    note: 'Reading, the job’s own records and (once you approve a plan) building and checks in its worktree run by themselves. Everything else asks.',
    hint: 'The dashboard’s own list decides what counts as routine; anything not on it comes to you. This is the default.',
  },
  {
    id: 'auto',
    label: 'Auto mode',
    note: 'Claude Code’s safety model judges each step: it allows safe ones and blocks risky ones by itself. Only what it can’t decide, and the very risky steps your go-ahead doesn’t cover, come to you; what it blocks shows as a dim line in the conversation.',
    hint: 'Fewer cards for you. The safety model uses a little of your Claude usage on each step it judges.',
  },
];

export const policyLabel = (id: PolicyId | null | undefined): string => POLICIES.find((p) => p.id === id)?.label ?? 'Routine steps automatic';

export const autoModeOf = (settings: Settings | undefined | null): AutoModeStatus => settings?.autoMode ?? { available: null, reason: null, checkedAt: null };

/** Why auto mode can't be picked right now, or null when it can. */
export function autoBlockedReason(status: AutoModeStatus): string | null {
  if (status.available !== false) return null;
  return status.reason || 'Auto mode isn’t available for your account.';
}
