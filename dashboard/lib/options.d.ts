// Types for the parts of options.js the new UI (web/, TypeScript) imports: its tests check the page
// against the dashboard's own level and option tables instead of a copy.

import type { LevelInfo, OptionChoice, ReviewerInfo } from '../../web/src/api/types';

export function levelsForClient(): LevelInfo[];
export const SKIPPABLE: OptionChoice[];
export const REVIEWERS: ReviewerInfo[];
