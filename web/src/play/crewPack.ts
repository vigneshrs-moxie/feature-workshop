// The crew pack: the one place the crew's generic roles live (packet M). Every screen that names
// a crew member by its job reads it here, so renaming the crew (or the product around it) is a
// change to this file. Roles match dashboard/lib/stages.js AGENTS.

import type { StopId } from '../api/types';

/** The generic role word for each agent type: what the Job map, the Stage and the alerts say. */
export const ROLE_WORDS: Readonly<Record<string, string>> = {
  conductor: 'Foreman',
  'feature-spec-writer': 'Writer',
  'feature-wireframer': 'Designer',
  'feature-investigator': 'Investigator',
  'feature-planner': 'Planner',
  'feature-implementer': 'Builder',
  'feature-tester': 'Tester',
  'feature-reviewer': 'Reviewer',
  'feature-review-permissions': 'Access reviewer',
  'feature-review-tests': 'Test reviewer',
  'feature-review-conventions': 'Rules reviewer',
  'feature-review-errors': 'Errors reviewer',
  'feature-review-db': 'Database reviewer',
  'feature-review-performance': 'Speed reviewer',
  'feature-review-ui': 'Screens reviewer',
  'feature-fable-check': 'Second look',
};

/** "Builder" for feature-implementer; the Foreman for none; "Helper" for a type this pack doesn't know. */
export function roleOf(agentType: string | null | undefined): string {
  if (!agentType) return ROLE_WORDS.conductor;
  return ROLE_WORDS[agentType] ?? 'Helper';
}

/** Who works each stop of the Job map (the face on its circle in Play full). */
export const STOP_CREW: Readonly<Record<StopId, string>> = {
  spec: 'feature-spec-writer',
  investigate: 'feature-investigator',
  plan: 'feature-planner',
  build: 'feature-implementer',
  test: 'feature-tester',
  review: 'feature-reviewer',
  ship: 'conductor',
};
