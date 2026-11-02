// Which of the five Starbase tools a figure holds: the Foreman's holo-slate, the Builder's welder,
// the Tester's scanner, a Reviewer's inspection lens, the Planner's holo-tablet. From the tool each
// agent type already has in the crew pack (crewPack.ts), folded onto the five; the crew pack's
// names and helmet fittings are not used on the station.
import { CREW_PACK, PACK_ALIASES, type ToolId } from '../crewPack';
import type { PropId } from './types';

// Every review lens is a Reviewer, so all their tools (key, gauge, brick, fuse, stopwatch, brush)
// fold onto the inspection lens; drawing and writing tools onto the holo-tablet.
const BY_TOOL: Record<ToolId, PropId> = {
  slate: 'slate',
  welder: 'welder',
  scanner: 'scanner',
  tablet: 'tablet', ruler: 'tablet', quill: 'tablet',
  lens: 'lens', magnifier: 'lens', key: 'lens', gauge: 'lens', brick: 'lens', fuse: 'lens', stopwatch: 'lens', brush: 'lens',
};

/** The prop for an agent type; an unknown helper carries a holo-slate like the Foreman. */
export function propFor(agentType: string | null | undefined): PropId {
  if (!agentType || agentType === 'conductor') return 'slate';
  // The wireframer draws: it gets the Planner's holo-tablet rather than the screens reviewer's lens.
  if (agentType === 'feature-wireframer') return 'tablet';
  const type = PACK_ALIASES[agentType] ?? agentType;
  const tool = CREW_PACK.find((m) => m.type === type)?.tool;
  return tool ? BY_TOOL[tool] : 'slate';
}
