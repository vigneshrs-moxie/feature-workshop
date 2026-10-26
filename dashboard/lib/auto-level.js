// "Choose the level for me" (Settings → Workflow, off by default): the dashboard picks a job's level
// itself, and checks it again against what each build really changed. Pure; the server runs it.
//
// Choosing: once the Foreman's first brief names a level (status.json suggested_level) and the files
// it expects to touch (predicted_paths), the pick is the highest of the rules' level on the
// description, the rules' level on those files, and the Foreman's. It is never lower than a level
// already set. It asks you instead of choosing when a risk rule sets L3, when the rules and the
// Foreman are two or more levels apart, or when the description is too short to judge.
//
// Re-checking: after a build, the rules run on the branch's real diff. A floor above the job's level
// raises it (never lowers). L0 also has hard limits: about 3 files, about 50 changed lines, existing
// files only, and no risk rule at all; past any of them it becomes L1.
//
// KEEP IN STEP with the /feature skill's job-options.md ("Automatic level" and "L0 limits").

import { suggestLevel } from './level-rules.js';

export const L0_LIMITS = { files: 3, lines: 50 };
const VAGUE_WORDS = 5;

const lvl = (n) => (Number.isInteger(n) && n >= 0 && n <= 3 ? n : null);
const wordCount = (s) => (String(s ?? '').trim() ? String(s).trim().split(/\s+/).length : 0);

/**
 * { level, ask, note, rules, foreman, floor, triggers }
 *   ask: why it asks you instead (null when it chose); note: the one line for the conversation.
 */
export function chooseLevel({ description = '', predictedPaths = [], foreman = null, current = null } = {}) {
  const fromText = suggestLevel({ description });
  const fromFiles = suggestLevel({ description, paths: predictedPaths });
  const rules = Math.max(fromText.level, fromFiles.level);
  const floor = Math.max(fromText.floor, fromFiles.floor);
  const triggers = [...new Set([...fromText.triggers, ...fromFiles.triggers])];
  const said = lvl(foreman);
  const level = Math.max(rules, said ?? 0, lvl(current) ?? 0);
  let ask = null;
  if (floor >= 3) ask = `A risk rule sets L3 (${(fromFiles.floorReasons.find((r) => /at least L3/.test(r)) ?? 'see the rules').replace(/^Touches /, 'touches ').replace(/, so at least L3\.$/, '')}).`;
  else if (said !== null && Math.abs(rules - said) >= 2) ask = `The rules say L${rules} and the Foreman says L${said}: too far apart to pick for you.`;
  else if (wordCount(description) < VAGUE_WORDS) ask = 'The description is too short to judge the size of the change.';
  const parts = [`rules L${rules}`, said !== null ? `Foreman L${said}` : null, lvl(current) !== null && current > Math.max(rules, said ?? 0) ? `already L${current}` : null].filter(Boolean);
  const note = ask ? null : `Level set to L${level} automatically (${parts.join(', ')}; the higher one wins).`;
  return { level, ask, note, rules, foreman: said, floor, triggers };
}

/**
 * After a build: { raiseTo, reasons } from the branch's diff ({ paths, lines, added }: the changed
 * files, added + deleted lines, and the files that are new). raiseTo is null when the level holds.
 */
export function checkDiff({ level, description = '', diff }) {
  const now = lvl(level);
  if (now === null || !diff || !Array.isArray(diff.paths)) return { raiseTo: null, reasons: [] };
  const rules = suggestLevel({ description, paths: diff.paths });
  const reasons = [];
  let raiseTo = now;
  if (rules.floor > now) { raiseTo = rules.floor; reasons.push(...rules.floorReasons); }
  if (now === 0) {
    const over = [];
    if (diff.paths.length > L0_LIMITS.files) over.push(`${diff.paths.length} files (L0 allows about ${L0_LIMITS.files})`);
    if (Number.isFinite(diff.lines) && diff.lines > L0_LIMITS.lines) over.push(`${diff.lines} changed lines (about ${L0_LIMITS.lines})`);
    if (Array.isArray(diff.added) && diff.added.length) over.push(`new file${diff.added.length === 1 ? '' : 's'} ${diff.added.slice(0, 3).join(', ')} (L0 changes existing files only)`);
    if (rules.triggers.length && rules.floor <= now) over.push('a risk rule fired');
    if (over.length) { raiseTo = Math.max(raiseTo, 1); reasons.push(`Past the L0 limits: ${over.join('; ')}.`); }
  }
  return raiseTo > now ? { raiseTo, reasons } : { raiseTo: null, reasons: [] };
}
