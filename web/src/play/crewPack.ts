// The crew pack: the one place the crew's names, generic roles and looks live (packet M). Every
// screen that names a crew member or draws one reads it here (crew.ts builds the Crew-dex and the
// faces from it), so renaming the crew, or the product around it, is a change to this file only.
// Types match dashboard/lib/stages.js AGENTS; the role words match dashboard/lib/stage-view.js.

import type { StopId } from '../api/types';

export type HatId = 'hardhat' | 'beret' | 'deerstalker' | 'cap' | 'bandana' | 'goggles' | 'visor';
export type ToolId = 'clipboard' | 'check' | 'quill' | 'magnifier' | 'blueprint' | 'hammer' | 'flask' | 'key' | 'gauge' | 'ruler' | 'fuse' | 'brick' | 'stopwatch' | 'brush';
export type Family = 'haiku' | 'sonnet' | 'opus' | 'fable';

export interface PackMember {
  /** The agent type (dashboard/lib/stages.js AGENTS). */
  type: string;
  /** The character's name: the Crew-dex, the thread in Play. */
  name: string;
  /** The generic role word every screen uses: the Job map, the Stage, the alerts. */
  roleWord: string;
  /** What it does, in a line (the Crew-dex card). */
  role: string;
  hat: HatId;
  tool: ToolId;
  /** The Crew-dex card back: one short fixed line. */
  bio: string;
  /** The model family its agent file usually names. */
  model: Family;
}

/** The crew in Crew-dex order, the Foreman first. */
export const CREW_PACK: readonly PackMember[] = [
  { type: 'conductor', name: 'Foreman', roleWord: 'Foreman', role: 'Conductor: runs the workshop and talks to you', hat: 'hardhat', tool: 'clipboard', model: 'opus',
    bio: 'Keeps fifteen schedules in its head and still remembers to ask how you’re doing.' },
  { type: 'feature-spec-writer', name: 'Scribe', roleWord: 'Writer', role: 'Writes and updates the product spec', hat: 'beret', tool: 'quill', model: 'opus',
    bio: 'Writes specs in ink. Keeps an eraser anyway, for luck.' },
  { type: 'feature-investigator', name: 'Sleuth', roleWord: 'Investigator', role: 'Investigates the code (read-only)', hat: 'deerstalker', tool: 'magnifier', model: 'opus',
    bio: 'Reads a codebase like a mystery novel and names the culprit by chapter two.' },
  { type: 'feature-planner', name: 'Draftsman', roleWord: 'Planner', role: 'Draws up the implementation and test plans', hat: 'cap', tool: 'blueprint', model: 'opus',
    bio: 'Can plan a feature in twelve tidy steps and a tea break in three.' },
  { type: 'feature-implementer', name: 'Builder', roleWord: 'Builder', role: 'Builds the plan, one commit per step', hat: 'bandana', tool: 'hammer', model: 'opus',
    bio: 'Measure twice, commit once. Hums while the tests run.' },
  { type: 'feature-tester', name: 'Tester', roleWord: 'Tester', role: 'Runs the approved checks', hat: 'goggles', tool: 'flask', model: 'sonnet',
    bio: 'Believes every bug is just a test nobody has written yet.' },
  { type: 'feature-reviewer', name: 'Head inspector', roleWord: 'Reviewer', role: 'Review: spec conformance and correctness', hat: 'visor', tool: 'check', model: 'opus',
    bio: 'Reads the spec, then the diff, then the spec again, just to be sure.' },
  { type: 'feature-review-permissions', name: 'Locksmith', roleWord: 'Access reviewer', role: 'Review: who can see and do what', hat: 'visor', tool: 'key', model: 'opus',
    bio: 'Has never met a door it trusted.' },
  { type: 'feature-review-tests', name: 'Gauge', roleWord: 'Test reviewer', role: 'Review: test coverage and quality', hat: 'visor', tool: 'gauge', model: 'sonnet',
    bio: 'Counts assertions the way other people count sheep.' },
  { type: 'feature-review-conventions', name: 'Stickler', roleWord: 'Rules reviewer', role: 'Review: the repo’s written rules', hat: 'visor', tool: 'ruler', model: 'haiku',
    bio: 'Knows the style guide by heart, footnotes included.' },
  { type: 'feature-review-errors', name: 'Fuse', roleWord: 'Errors reviewer', role: 'Review: errors and edge cases', hat: 'visor', tool: 'fuse', model: 'sonnet',
    bio: 'Always asks “but what if it’s empty?” Usually right.' },
  { type: 'feature-review-db', name: 'Mason', roleWord: 'Database reviewer', role: 'Review: migrations, schema and data integrity', hat: 'visor', tool: 'brick', model: 'sonnet',
    bio: 'Lays migrations like bricks: level, reversible, never on a Friday.' },
  { type: 'feature-review-performance', name: 'Stopwatch', roleWord: 'Speed reviewer', role: 'Review: speed with lots of data', hat: 'visor', tool: 'stopwatch', model: 'sonnet',
    bio: 'Thinks in big-O and dreams of well-placed indexes.' },
  { type: 'feature-review-ui', name: 'Painter', roleWord: 'Screens reviewer', role: 'Review: screens, wording and accessibility', hat: 'visor', tool: 'brush', model: 'sonnet',
    bio: 'Spots the one-pixel nudge you hoped nobody would notice.' },
  { type: 'feature-fable-check', name: 'Oracle', roleWord: 'Second look', role: 'Fable second look at one document or change', hat: 'beret', tool: 'magnifier', model: 'fable',
    bio: 'Speaks rarely, sees far, and reads the whole plan before saying a word.' },
];

/** Workers drawn by another member of the pack: the wireframer is drawn as the screens reviewer (dashboard/lib/stages.js AGENT_ALIASES). */
export const PACK_ALIASES: Readonly<Record<string, string>> = { 'feature-wireframer': 'feature-review-ui' };

/** The generic role word for each agent type: what the Job map, the Stage and the alerts say. */
export const ROLE_WORDS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(CREW_PACK.map((m) => [m.type, m.roleWord])),
  'feature-wireframer': 'Designer',
};

/** "Builder" for feature-implementer; the Foreman for none; "Helper" for a type this pack doesn't know. */
export function roleOf(agentType: string | null | undefined): string {
  if (!agentType) return ROLE_WORDS.conductor;
  return ROLE_WORDS[agentType] ?? 'Helper';
}

/** The character's name for an agent type ("Sleuth"); its role word when the pack has no character for it. */
export function nameOf(agentType: string): string {
  const t = PACK_ALIASES[agentType] ?? agentType;
  return CREW_PACK.find((m) => m.type === t)?.name ?? roleOf(agentType);
}

/** Two letters for a role, for where Play doesn't draw the crew: "B" for Builder, "AR" for Access reviewer. */
export function initialsOf(agentType: string | null | undefined): string {
  return roleOf(agentType).split(/\s+/).map((w) => w.charAt(0).toUpperCase()).join('').slice(0, 2);
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
