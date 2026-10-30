// Which of the five props a figure holds: the Foreman's clipboard, the Builder's hammer, the
// Tester's flask, a Reviewer's magnifier, the Planner's ruler. From the generic tool each agent
// type already has in the crew pack (crewPack.ts), folded onto the five; the crew pack's names and
// hats are not used on the floor.
import { CREW_PACK, PACK_ALIASES, type ToolId } from '../crewPack';
import type { PropId } from './types';

// Every review lens is a Reviewer, so all their tools (check, key, gauge, brick, fuse, stopwatch,
// brush) fold onto the magnifier; drawing and writing tools onto the ruler.
const BY_TOOL: Record<ToolId, PropId> = {
  clipboard: 'clipboard',
  hammer: 'hammer',
  flask: 'flask',
  ruler: 'ruler', blueprint: 'ruler', quill: 'ruler',
  magnifier: 'magnifier', check: 'magnifier', key: 'magnifier', gauge: 'magnifier', brick: 'magnifier', fuse: 'magnifier', stopwatch: 'magnifier', brush: 'magnifier',
};

/** The prop for an agent type; an unknown helper carries a clipboard like the Foreman. */
export function propFor(agentType: string | null | undefined): PropId {
  if (!agentType || agentType === 'conductor') return 'clipboard';
  // The wireframer draws: it gets the Planner's ruler rather than the screens reviewer's magnifier.
  if (agentType === 'feature-wireframer') return 'ruler';
  const type = PACK_ALIASES[agentType] ?? agentType;
  const tool = CREW_PACK.find((m) => m.type === type)?.tool;
  return tool ? BY_TOOL[tool] : 'clipboard';
}
