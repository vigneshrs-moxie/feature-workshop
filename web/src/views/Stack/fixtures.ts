// Test views of a stack in every state the Stack wireframe draws (the shapes of dashboard/lib/stack.js
// describeStack). Tests only.
import type { StackPart, StackSectionState, StackStep, StackSummary, StackView } from '../../api/types';

const STEP_IDS = ['plan', 'build', 'merge', 'push'] as const;
export function steps(at: 'plan' | 'build' | 'merge' | 'push' | 'pushed'): StackStep[] {
  const i = at === 'pushed' ? 4 : STEP_IDS.indexOf(at);
  return STEP_IDS.map((id, n) => {
    const state = n < i ? 'done' : n === i ? 'now' : 'next';
    return { id, label: id.charAt(0).toUpperCase() + id.slice(1), state, words: state === 'done' ? 'Done' : state === 'now' ? 'Now' : 'Not yet' };
  });
}

const BRIEF: Record<string, string> = {
  'export-button': 'Export button on the tech schedule page: a button that downloads the week.',
  'csv-writer': 'CSV writer: one row per visit.',
  email: 'After-hours email to the branch manager when a schedule changes.',
};
const OWNS: Record<string, string[]> = {
  'export-button': ['app/ui/schedule/export/**', 'app/ui/schedule/Toolbar.tsx'],
  'csv-writer': ['app/lib/csv/**', 'app/lib/csv.test.ts'],
  email: ['app/jobs/schedule-email/**'],
};
const WORDS: Record<StackSectionState, string> = { pending: 'Queued', running: 'Building', blocked: 'Back with its Foreman', ready: 'Ready to merge', integrated: 'Merged', failed: 'Stuck: needs you' };

export function part(n: number, name: string, state: StackSectionState, extra: Partial<StackPart> = {}): StackPart {
  const started = state !== 'pending';
  return {
    n, name, brief: BRIEF[name] ?? `${name}.`, owns: OWNS[name] ?? [`${name}/**`], dependsOn: name === 'email' ? ['csv-writer'] : [],
    state, stateWords: WORDS[state], reason: null,
    progress: { stage: started ? 'implement' : null, step: started ? 1 : 0, of: 4, words: started ? 'Building' : 'Not started' },
    run: state === 'running' ? 'running' : null,
    slug: started ? `orbit-512--${name}` : null, branch: started ? `feature/orbit-512--${name}` : null,
    worktree: started ? `/w/orbit-512--${name}` : null, port: started ? 24810 + n : null,
    failures: 0, stuck: state === 'failed', problem: null, model: null, effort: null,
    mergedAt: state === 'integrated' ? '2026-10-29T14:46:00Z' : null, mergeSha: state === 'integrated' ? 'abc1234' : null,
    ...extra,
  };
}

export function stackView(over: Partial<StackView> = {}, states: StackSectionState[] | null = null, partExtra: Record<string, Partial<StackPart>> = {}): StackView {
  const names = ['export-button', 'csv-writer', 'email'];
  const approved = states !== null;
  const parts = names.map((name, i) => part(i + 1, name, approved ? states![i] : 'pending', { ...(approved ? {} : { reason: 'Starts once you approve the plan' }), ...partExtra[name] }));
  const allMerged = approved && parts.every((p) => p.state === 'integrated');
  const phase = !approved ? 'plan' : allMerged ? (over.push?.state === 'pushed' ? 'pushed' : 'push') : parts.some((p) => p.state === 'ready' || p.state === 'integrated') ? 'merge' : 'build';
  return {
    slug: 'orbit-512', title: 'Tech schedule export', ticketKey: 'ORBIT-512', phase, steps: steps(phase),
    next: { action: !approved ? 'approve-plan' : 'wait', label: null, key: null, words: 'Building.' },
    plan: { ok: true, why: 'The button and the writer change different folders.', errors: [], warnings: [], changedSinceApproval: false },
    approved, cap: 2, autoIntegrate: false, model: 'claude-opus-5-5', effort: 'high', coordinatorEffort: 'xhigh',
    globalCap: 3, globalRunning: 2, running: parts.filter((p) => p.state === 'running' || p.state === 'blocked').length,
    parentBranch: approved ? 'feature/orbit-512' : null, parentWorktree: approved ? '/w/orbit-512' : null, repo: approved ? '/r' : null,
    push: approved ? { state: 'waiting', approvedAt: null, pushedAt: null, note: null, remote: 'moxie' } : null,
    nextToMerge: approved ? parts.find((p) => p.state !== 'integrated')?.name ?? null : null,
    busy: null, parts,
    log: approved ? [{ at: '2026-10-29T14:00:00Z', event: 'plan-approved', words: 'The plan was approved: 3 parts.' }] : [],
    coordinator: null,
    ...over,
  };
}

export function summary(view: StackView): StackSummary {
  const counts: StackSummary['counts'] = {};
  for (const p of view.parts) counts[p.state] = (counts[p.state] ?? 0) + 1;
  return {
    slug: view.slug, title: view.title, ticketKey: view.ticketKey, phase: view.phase, steps: view.steps, parts: view.parts.length,
    counts, needs: view.next.words, action: view.next.action,
    sections: view.parts.map((p) => ({ n: p.n, name: p.name, slug: p.slug, state: p.state, stateWords: p.stateWords })),
  };
}
