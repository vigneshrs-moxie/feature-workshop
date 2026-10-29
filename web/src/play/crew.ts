// The workshop crew, as the crew pack (crewPack.ts) has them: who they are, how they are drawn (a
// hat and a tool on the shared rig, see CrewMember.tsx), a fixed bio line for the Crew-dex card
// back, and how rare their model is. Nothing here is read from the network
// except the models (meta.crewModels), and none of it is ever user input.

/** A mood. thinking: the Foreman deciding what's next (eyes up, a thought bubble). */
export type CrewState = 'working' | 'waiting' | 'idle' | 'asleep' | 'celebrating' | 'walking' | 'thinking';
export const CREW_STATES: readonly CrewState[] = ['working', 'waiting', 'idle', 'asleep', 'celebrating', 'walking', 'thinking'];

export type { HatId, ToolId } from './crewPack';
/** How a tool is used: decides the working animation. */
export type Motion = 'strike' | 'write' | 'scan' | 'shake';
import type { HatId, ToolId, Family } from './crewPack';
import { CREW_PACK, PACK_ALIASES } from './crewPack';

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

const FAMILY_RARITY: Record<Family, Rarity> = { haiku: 'common', sonnet: 'uncommon', opus: 'rare', fable: 'legendary' };

export interface CrewInfo {
  type: string;
  /** Crew-dex number, 1–15 (#001–#015). */
  number: number;
  name: string;
  /** What it does, in a line (the Crew-dex card). */
  role: string;
  /** Its generic role word: Foreman, Planner, Builder… (crewPack.ts ROLE_WORDS). */
  roleWord: string;
  hat: HatId;
  tool: ToolId;
  /** The Crew-dex card back: one short fixed line. */
  bio: string;
  /** The model family the agent file usually names, for when meta.crewModels doesn't say. */
  model: Family;
}

// Who they are, how they look and what they're called come from the crew pack (crewPack.ts).
const ROSTER = CREW_PACK;

/** The 15 crew members in Crew-dex order, the Foreman first. */
export const CREW: readonly CrewInfo[] = ROSTER.map((c, i) => ({ ...c, number: i + 1 }));
export const CREW_TYPES: readonly string[] = CREW.map((c) => c.type);
const BY_TYPE = new Map(CREW.map((c) => [c.type, c]));

/** "#001" … "#015". */
export const dexNumber = (n: number) => `#${String(n).padStart(3, '0')}`;

/** Workers drawn by an existing character (the pack's aliases, as dashboard/lib/stages.js AGENT_ALIASES). */
const ALIASES: Readonly<Record<string, string>> = PACK_ALIASES;

/** A crew member by agent type; an unknown helper gets a plain look and its type as the name. */
export function crewInfo(type: string | null | undefined): CrewInfo {
  const known = type ? BY_TYPE.get(ALIASES[type] ?? type) : undefined;
  if (known) return known;
  return { type: type || 'unknown', number: 0, name: type || 'Helper', role: 'Other agent', roleWord: 'Helper', hat: 'cap', tool: 'clipboard', bio: '', model: 'sonnet' };
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

/** The review lenses (lib/options.js REVIEWERS): the Head inspector and the seven feature-review-* types. */
export const isLensType = (type: string) => type === 'feature-reviewer' || type.startsWith('feature-review-');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A model's friendly name: the dashboard's own label when it has one (choices: meta.models and
 * meta.jobOptions.models.choices), else made from the id ("claude-sonnet-5-5" → "Sonnet 5.5",
 * "haiku" → "Haiku"), else the id itself. Null for no model.
 */
export function modelName(model: string | null | undefined, choices: readonly { id: string; label: string }[] = []): string | null {
  if (!model) return null;
  const known = choices.find((c) => c.id === model);
  if (known) return known.label;
  const m = /(fable|opus|sonnet|haiku)(?:[-_ ]?(\d+)(?:[-.](\d+))?)?/i.exec(model);
  if (!m) return model;
  return [cap(m[1].toLowerCase()), m[2] ? `${m[2]}${m[3] ? `.${m[3]}` : ''}` : ''].filter(Boolean).join(' ');
}

/**
 * The model a crew member runs on, by name: the Foreman is Opus at every level (the everyday choice,
 * models[0]) unless you pick another for a job; everyone else from their agent file
 * (meta.crewModels), else the family they usually run on.
 */
export function crewModelName(
  type: string,
  meta: { models?: readonly { id: string; label: string }[]; crewModels?: Record<string, { model: string | null } | undefined>; jobOptions?: { models?: { choices?: readonly { id: string; label: string }[] } } } | null | undefined,
): string {
  const choices = [...(meta?.models ?? []), ...(meta?.jobOptions?.models?.choices ?? [])];
  if (type === 'conductor') return modelName(meta?.models?.[0]?.id, choices) ?? 'Opus';
  return modelName(meta?.crewModels?.[type]?.model, choices) ?? cap(crewInfo(type).model);
}

/** The character who stands at each stage. */
export const STAGE_CHARACTER: Record<string, string> = {
  // Clarify is the Foreman's own questions; the Painter (the ui lens) draws the screens.
  clarify: 'conductor', wireframe: 'feature-review-ui',
  spec: 'feature-spec-writer', refine: 'feature-spec-writer', investigate: 'feature-investigator',
  'spec-update': 'feature-spec-writer', plan: 'feature-planner', implement: 'feature-implementer',
  test: 'feature-tester', review: 'feature-reviewer', pr1: 'conductor', pr2: 'conductor',
  'staging-qa': 'feature-tester', pr3: 'conductor',
};
