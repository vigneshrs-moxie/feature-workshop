// Stage names and hints for the stage chip. A copy of STAGES in dashboard/lib/stages.js (the
// dashboard sends only the id); keep the two in step. An unknown id is shown as it is.

export const STAGE_INFO: Record<string, { label: string; tip: string }> = {
  spec: { label: 'Spec', tip: 'Writing down what the feature should do, in product terms.' },
  refine: { label: 'Refine', tip: 'A detailed product interview. Large features only.' },
  investigate: { label: 'Investigate', tip: 'Reading the code to see how the feature fits. No changes.' },
  'spec-update': { label: 'Spec update', tip: 'Adjusting the spec because the code showed something new.' },
  plan: { label: 'Plan', tip: 'The step-by-step implementation plan and test plan.' },
  implement: { label: 'Build', tip: 'Coding the approved plan, one commit per step, in its own folder (worktree).' },
  test: { label: 'Test', tip: 'Running the approved checks and reporting each acceptance criterion.' },
  review: { label: 'Review', tip: 'Several reviewers look at the change from different angles.' },
  pr1: { label: 'PR #1', tip: 'Your fork to the same-named org branch. You review and merge it.' },
  pr2: { label: 'PR #2', tip: 'Org branch to staging.' },
  'staging-qa': { label: 'Staging QA', tip: 'Checking the feature on staging.' },
  pr3: { label: 'PR #3', tip: 'Staging to main. The release owner runs it.' },
};

export function stageLabel(id: string | null | undefined): string {
  if (!id) return '';
  return STAGE_INFO[id]?.label ?? id;
}

export function stageHint(id: string | null | undefined): string {
  if (!id) return '';
  const info = STAGE_INFO[id];
  return info ? `Stage: ${info.label}. ${info.tip}` : `Stage: ${id}.`;
}

/** The six stage families themes colour (--stage-<family>-fg/-bg), in workflow order. */
export type StageFamily = 'spec' | 'investigate' | 'plan' | 'build' | 'test' | 'review';

const FAMILY: Record<string, StageFamily> = {
  spec: 'spec',
  refine: 'spec',
  'spec-update': 'spec',
  investigate: 'investigate',
  plan: 'plan',
  implement: 'build',
  test: 'test',
  review: 'review',
  // Shipping stages (the PRs and staging QA) are reviews of the finished work.
  pr1: 'review',
  pr2: 'review',
  'staging-qa': 'review',
  pr3: 'review',
};

/** Which family a stage id belongs to, for the chip's data-stage hook. Unknown ids count as 'spec'. */
export function stageFamily(id: string | null | undefined): StageFamily {
  return (id && FAMILY[id]) || 'spec';
}
