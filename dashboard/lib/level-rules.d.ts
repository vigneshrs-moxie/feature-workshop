// Types for level-rules.js, so the new UI (web/, TypeScript) can import the very same rules the
// dashboard uses to suggest a level, instead of a copy.

export interface RiskTrigger {
  id: string;
  label: string;
  floor: number;
  text: RegExp;
  withContext?: { phrase: RegExp; context: RegExp };
  path: RegExp;
}

export const RISK_TRIGGERS: RiskTrigger[];

export interface LevelSuggestion {
  level: 0 | 1 | 2 | 3;
  /** The lowest level the risk rules allow (0: none applies). */
  floor: number;
  /** Plain sentences: the risk ones, then one about the size of the change. */
  reasons: string[];
  /** Only the reasons that set the floor. */
  floorReasons: string[];
  /** Ids of the risk triggers that fired. */
  triggers: string[];
}

export function suggestLevel(input?: { description?: string; paths?: string[] }): LevelSuggestion;
