// How big the crew are drawn, in px, in one place (Play, round 2: "the crew bigger"). Where a spot
// has two, Subtle takes the first and Full the second: Full is a little bigger, Subtle still easy
// to see. Every caller of CrewMember takes its size from here.

export const CREW_SIZE = {
  /** A crew member with its name on a thread line ("[Sleuth] Sleuth"). */
  tag: [28, 32],
  /** The workers a routine-steps line handed work to. */
  handoff: [28, 32],
  /** Who is at work in the live row. */
  live: [36, 44],
  /** The crew asleep in a paused live row (Full only). */
  sleeping: 40,
  /** The Foreman by the job's title. */
  foreman: 40,
  /** A review brief's reviewers. */
  lineup: 32,
  /** The crew member standing on the job's trail (play/JobTrail.tsx). */
  trail: [56, 64],
  /** The same on a card on the workshop floor. */
  floorCard: [44, 48],
  /** The Foreman speaking on the workshop floor. */
  floorForeman: 96,
  /** A job's crew member in the Jobs list. */
  row: 30,
  /** The Foreman mascot by "Feature Workshop" in the top bar. */
  mascot: 30,
  /** A scene with the toasts: one actor, or the git blame group. */
  scene: 56,
  sceneGroup: 42,
  /** The Locksmith's door over the palette, and the Friday eyebrow. */
  door: 56,
  friday: 36,
  /** The Sleuth on the not-found page, and a Crew-dex card portrait. */
  notFound: 96,
  dex: 104,
} as const;

type Pair = readonly [number, number];

/** A spot's size for the mode: the Full one when `full` and the spot has two. */
export function crewSize(spot: number | Pair, full: boolean | undefined): number {
  return typeof spot === 'number' ? spot : spot[full ? 1 : 0];
}

/** The medals: on a toast, and in Achievements. */
export const MEDAL_SIZE = { toast: 44, list: 56 } as const;
