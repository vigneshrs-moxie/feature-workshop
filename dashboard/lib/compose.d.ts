// Types for compose.js, so the new UI (web/, TypeScript) can import the very same function the
// classic page uses (/shared/compose.js) instead of a copy.

export interface ComposeQuestion {
  id: string;
  text: string;
  options: { id: string; label: string }[];
}

export interface ComposeStatus {
  questions?: ComposeQuestion[] | null;
  decidedOnYourBehalf?: { id?: string; decision?: string; confirmed?: boolean }[] | null;
  nextProposed?: string | null;
  spec?: { version?: string | number | null; status?: string | null } | null;
  artifacts?: { name: string; version?: string | number | null }[] | null;
  brief?: { number?: number | null } | null;
}

export type ComposeKind = 'approve' | 'changes' | 'stop' | 'message';
export type ComposeAnswers = Record<string, { choice?: string; other?: string }>;
export type ComposeVerdicts = Record<string, { verdict: 'confirm' | 'change'; note?: string }>;

/** A stage a chip can name (a status.json stage id). */
export type ChipStage = 'spec' | 'refine' | 'investigate' | 'spec-update' | 'plan' | 'implement' | 'test' | 'review';
/** A Fable second-look point. */
export type ChipPoint = 'spec' | 'plan' | 'review' | 'pr';

/** A next-step chip from the gate card; each becomes one "Option change for the next step: …" line. */
export type GateChip =
  | { kind: 'skip'; stage: Exclude<ChipStage, 'implement'> }
  | { kind: 'lighter' | 'heavier' | 'self'; stage: ChipStage }
  | { kind: 'fable'; point: ChipPoint }
  | { kind: 'level'; level: 0 | 1 | 2 | 3; was: 0 | 1 | 2 | 3 };

export const CHIP_STAGES: ChipStage[];
export const CHIP_SKIPPABLE: Exclude<ChipStage, 'implement'>[];
export const CHIP_POINTS: ChipPoint[];
export const CHIP_KINDS: GateChip['kind'][];
export const MAX_CHIPS: number;

/** One chip's line, or null when the chip is malformed. */
export function chipLine(chip: unknown): string | null;
/** The chips worth sending: malformed ones and repeats left out, one level change at most, at most MAX_CHIPS. */
export function cleanChips(chips: unknown): GateChip[];

export function composeReply(args: {
  kind: ComposeKind;
  status?: ComposeStatus;
  answers?: ComposeAnswers;
  verdicts?: ComposeVerdicts;
  note?: string;
  chips?: GateChip[];
}): string;
