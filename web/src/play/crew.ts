// The workshop crew: who they are (names and roles as dashboard/lib/stages.js AGENTS has them),
// how they are drawn (a hat and a tool on the shared rig, see CrewMember.tsx), a fixed bio line
// for the Crew-dex card back, and how rare their model is. Nothing here is read from the network
// except the models (meta.crewModels), and none of it is ever user input.

/** A mood. thinking: the Foreman deciding what's next (eyes up, a thought bubble). */
export type CrewState = 'working' | 'waiting' | 'idle' | 'asleep' | 'celebrating' | 'walking' | 'thinking';
export const CREW_STATES: readonly CrewState[] = ['working', 'waiting', 'idle', 'asleep', 'celebrating', 'walking', 'thinking'];

export type HatId = 'hardhat' | 'beret' | 'deerstalker' | 'cap' | 'bandana' | 'goggles' | 'visor';
export type ToolId = 'clipboard' | 'check' | 'quill' | 'magnifier' | 'blueprint' | 'hammer' | 'flask' | 'key' | 'gauge' | 'ruler' | 'fuse' | 'brick' | 'stopwatch' | 'brush';
/** How a tool is used: decides the working animation. */
export type Motion = 'strike' | 'write' | 'scan' | 'shake';

export const MOTION: Record<ToolId, Motion> = {
  hammer: 'strike', brick: 'strike', check: 'strike', key: 'strike', clipboard: 'strike',
  quill: 'write', brush: 'write', ruler: 'write', blueprint: 'write',
  magnifier: 'scan', gauge: 'scan', stopwatch: 'scan',
  flask: 'shake', fuse: 'shake',
};

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export const RARITY_LABEL: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary' };
/** Haiku common · Sonnet uncommon · Opus rare · Fable legendary. */
export const RARITY_HINT: Record<Rarity, string> = {
  common: 'Common: runs on Haiku.',
  uncommon: 'Uncommon: runs on Sonnet.',
  rare: 'Rare: runs on Opus.',
  legendary: 'Legendary: runs on Fable.',
};

type Family = 'haiku' | 'sonnet' | 'opus' | 'fable';
const FAMILY_RARITY: Record<Family, Rarity> = { haiku: 'common', sonnet: 'uncommon', opus: 'rare', fable: 'legendary' };

export interface CrewInfo {
  type: string;
  /** Crew-dex number, 1–15 (#001–#015). */
  number: number;
  name: string;
  role: string;
  hat: HatId;
  tool: ToolId;
  /** The Crew-dex card back: one short fixed line. */
  bio: string;
  /** The model family the agent file usually names, for when meta.crewModels doesn't say. */
  model: Family;
}

const ROSTER: Omit<CrewInfo, 'number'>[] = [
  { type: 'conductor', name: 'Foreman', role: 'Conductor: runs the workshop and talks to you', hat: 'hardhat', tool: 'clipboard', model: 'opus',
    bio: 'Keeps fifteen schedules in its head and still remembers to ask how you’re doing.' },
  { type: 'feature-spec-writer', name: 'Scribe', role: 'Writes and updates the product spec', hat: 'beret', tool: 'quill', model: 'opus',
    bio: 'Writes specs in ink. Keeps an eraser anyway, for luck.' },
  { type: 'feature-investigator', name: 'Sleuth', role: 'Investigates the code (read-only)', hat: 'deerstalker', tool: 'magnifier', model: 'opus',
    bio: 'Reads a codebase like a mystery novel and names the culprit by chapter two.' },
  { type: 'feature-planner', name: 'Draftsman', role: 'Draws up the implementation and test plans', hat: 'cap', tool: 'blueprint', model: 'opus',
    bio: 'Can plan a feature in twelve tidy steps and a tea break in three.' },
  { type: 'feature-implementer', name: 'Builder', role: 'Builds the plan, one commit per step', hat: 'bandana', tool: 'hammer', model: 'opus',
    bio: 'Measure twice, commit once. Hums while the tests run.' },
  { type: 'feature-tester', name: 'Tester', role: 'Runs the approved checks', hat: 'goggles', tool: 'flask', model: 'sonnet',
    bio: 'Believes every bug is just a test nobody has written yet.' },
  { type: 'feature-reviewer', name: 'Head inspector', role: 'Review: spec conformance and correctness', hat: 'visor', tool: 'check', model: 'opus',
    bio: 'Reads the spec, then the diff, then the spec again, just to be sure.' },
  { type: 'feature-review-permissions', name: 'Locksmith', role: 'Review: who can see and do what', hat: 'visor', tool: 'key', model: 'opus',
    bio: 'Has never met a door it trusted.' },
  { type: 'feature-review-tests', name: 'Gauge', role: 'Review: test coverage and quality', hat: 'visor', tool: 'gauge', model: 'sonnet',
    bio: 'Counts assertions the way other people count sheep.' },
  { type: 'feature-review-conventions', name: 'Stickler', role: 'Review: the repo’s written rules', hat: 'visor', tool: 'ruler', model: 'haiku',
    bio: 'Knows the style guide by heart, footnotes included.' },
  { type: 'feature-review-errors', name: 'Fuse', role: 'Review: errors and edge cases', hat: 'visor', tool: 'fuse', model: 'sonnet',
    bio: 'Always asks “but what if it’s empty?” Usually right.' },
  { type: 'feature-review-db', name: 'Mason', role: 'Review: migrations, schema and data integrity', hat: 'visor', tool: 'brick', model: 'sonnet',
    bio: 'Lays migrations like bricks: level, reversible, never on a Friday.' },
  { type: 'feature-review-performance', name: 'Stopwatch', role: 'Review: speed with lots of data', hat: 'visor', tool: 'stopwatch', model: 'sonnet',
    bio: 'Thinks in big-O and dreams of well-placed indexes.' },
  { type: 'feature-review-ui', name: 'Painter', role: 'Review: screens, wording and accessibility', hat: 'visor', tool: 'brush', model: 'sonnet',
    bio: 'Spots the one-pixel nudge you hoped nobody would notice.' },
  { type: 'feature-fable-check', name: 'Oracle', role: 'Fable second look at one document or change', hat: 'beret', tool: 'magnifier', model: 'fable',
    bio: 'Speaks rarely, sees far, and reads the whole plan before saying a word.' },
];

/** The 15 crew members in Crew-dex order, the Foreman first. */
export const CREW: readonly CrewInfo[] = ROSTER.map((c, i) => ({ ...c, number: i + 1 }));
export const CREW_TYPES: readonly string[] = CREW.map((c) => c.type);
const BY_TYPE = new Map(CREW.map((c) => [c.type, c]));

/** "#001" … "#015". */
export const dexNumber = (n: number) => `#${String(n).padStart(3, '0')}`;

/** A crew member by agent type; an unknown helper gets a plain look and its type as the name. */
export function crewInfo(type: string | null | undefined): CrewInfo {
  const known = type ? BY_TYPE.get(type) : undefined;
  if (known) return known;
  return { type: type || 'unknown', number: 0, name: type || 'Helper', role: 'Other agent', hat: 'cap', tool: 'clipboard', bio: '', model: 'sonnet' };
}

export const isCrewType = (type: unknown): type is string => typeof type === 'string' && BY_TYPE.has(type);

/** The rarity of a model id or name ("claude-opus-5-5", "sonnet"), or null when it names none of them. */
export function rarityOf(model: string | null | undefined): Rarity | null {
  const m = String(model ?? '').toLowerCase();
  for (const f of ['fable', 'opus', 'sonnet', 'haiku'] as Family[]) if (m.includes(f)) return FAMILY_RARITY[f];
  return null;
}

/** A crew member's rarity from its agent file's model (meta.crewModels), else its usual model. */
export function crewRarity(type: string, crewModels?: Record<string, { model: string | null } | undefined> | null): Rarity {
  return rarityOf(crewModels?.[type]?.model) ?? FAMILY_RARITY[crewInfo(type).model];
}

/** The character who stands at each stage. */
export const STAGE_CHARACTER: Record<string, string> = {
  spec: 'feature-spec-writer', refine: 'feature-spec-writer', investigate: 'feature-investigator',
  'spec-update': 'feature-spec-writer', plan: 'feature-planner', implement: 'feature-implementer',
  test: 'feature-tester', review: 'feature-reviewer', pr1: 'conductor', pr2: 'conductor',
  'staging-qa': 'feature-tester', pr3: 'conductor',
};
