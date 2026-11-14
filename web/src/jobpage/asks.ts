// The asks (R6): one click for what he types again and again. ONE table: each ask's id, its label,
// the exact text it sends (shown on hover: no hidden prompts), the steps it belongs to, whether it is
// in the row above the message box or only in ⌘K, and whether it needs a word (its text has the gap,
// ▮: the ask puts its text in the box with the cursor there, and nothing is sent until Send).
//
// The labels and the steps are the design brief's table (Revision 3, R6), word for word; the texts
// are the revision 3 prototype's. The row (left/AsksRow.tsx) shows at most four, fitted to the open
// step: the step's own asks first, then the ones for any step. ⌘K (Palette.tsx) lists all of them.
//
// The Ship row (the PR's next action, Pull PR comments, Shorten the PR text, Mark done) and its ⌘K
// asks come with Tasks 20 and 22: the PR's next action goes first in the row through rowFor's `lead`,
// and only while the Ship step is not the open step (plan "Open with the owner").
//
// `Go faster` is not a message: it changes the job's options from the next step (fastOptions).
// `Keep as an ask` (the conversation) keeps a message he sent under sb.asks.kept in this browser
// (plan "Decisions already made" 7); ⌘K lists them under Yours.

import { readStored, writeStored } from '../lib/stored';
import type { StopId } from './types';

/** The gap an ask that needs a word leaves for it. */
export const GAP = '▮';

/** The brief's step groups: Spec and Plan share one (Investigate goes with them). */
export type AskGroup = 'any' | 'spec-plan' | 'build' | 'test' | 'review' | 'ship';

/** send: sends its text; fast: changes the job's options (Go faster). */
export type AskKind = 'send' | 'fast';

export interface Ask {
  id: string;
  label: string;
  /** Exactly what it sends (with GAP where his word goes), or, for Go faster, exactly what it switches. */
  text: string;
  /** The step groups it shows on. */
  steps: readonly AskGroup[];
  /** In the row above the message box for those steps; false: only in ⌘K. */
  inRow: boolean;
  /** Its text has a gap for his word: it fills the box instead of sending. */
  needsWord: boolean;
  kind: AskKind;
}

/** What Go faster says when it switched both. */
export const FAST_SAYS = 'Fast from the next step: 1 reviewer, no second looks';

const ask = (id: string, label: string, text: string, steps: AskGroup[], inRow: boolean, kind: AskKind = 'send'): Ask =>
  ({ id, label, text, steps, inRow, needsWord: text.includes(GAP), kind });

/** The table, in the brief's order: the row's asks of each group, then its ⌘K-only ones. */
export const ASKS: readonly Ask[] = [
  // Any step
  ask('where', 'Where are we?', 'Where are we? One short paragraph: what is done, what is next, and what you need from me.', ['any', 'build'], true),
  ask('explain', 'Explain this step', 'Explain this step in plain words: what it does, what it produced, and what I should check.', ['any'], true),
  ask('fast', 'Go faster', FAST_SAYS, ['any', 'spec-plan', 'build', 'review'], true, 'fast'),
  ask('stop', 'Stop here', 'Stop after the current step and wait for me.', ['any'], false),
  ask('rule', 'Make this the rule next time…', `Make this the rule for future jobs: ${GAP}`, ['any'], false),
  // Spec, Plan
  ask('summ', 'Summarise for approval', 'Summarise each part of the plan in one or two lines so I can approve or reject it quickly.', ['spec-plan'], true),
  ask('drop', 'Drop something…', `Drop ${GAP} from scope. Update the spec, plan and tests to match.`, ['spec-plan'], true),
  ask('reuse', 'Reuse what exists', 'Reuse components and styles that already exist in the repo. Don’t add new ones unless you have to.', ['spec-plan'], false),
  // Test
  ask('howtest', 'How do I test this by hand?', 'Give me numbered steps to test this by hand on my laptop, including which user to sign in as.', ['test'], true),
  ask('start', 'Start the app', 'Start Try it for this job.', ['test'], true),
  ask('works', 'It works', 'It works. I tested it by hand.', ['test'], true),
  ask('rerun', 'Run the checks again', 'Run the checks again on the latest commit and tell me the result.', ['test'], true),
  ask('record', 'Record again', 'Record the browser checks again on the latest commit.', ['test'], false),
  // Review
  ask('fixfind', 'Fix the open findings', 'Fix the open findings from the review, one commit each, then run the checks.', ['review'], true),
  ask('walkthrough', 'Publish the walkthrough', 'Publish the review walkthrough.', ['review'], false),
];

/** Each group's row, in the brief's order (Build lists `Where are we?` first, then `Go faster`). */
const ROWS: Record<AskGroup, readonly string[]> = {
  any: ['where', 'explain', 'fast'],
  'spec-plan': ['summ', 'drop', 'fast'],
  build: ['where', 'fast'],
  test: ['howtest', 'start', 'works', 'rerun'],
  review: ['fixfind', 'fast'],
  // Tasks 20 and 22: the PR's next action, Pull PR comments, Shorten the PR text, Mark done.
  ship: [],
};

/** The most the row holds. */
export const ROW_MAX = 4;

export const askById = (id: string): Ask | undefined => ASKS.find((a) => a.id === id);

/** The brief's group for a step (null: no step open yet). */
export function stepGroup(step: StopId | null): AskGroup {
  if (step === 'spec' || step === 'investigate' || step === 'plan') return 'spec-plan';
  if (step === 'build' || step === 'test' || step === 'review' || step === 'ship') return step;
  return 'any';
}

/**
 * The row for the open step: `lead` first when given (the PR's next action), then the step's own
 * asks, then the ones for any step, at most four.
 */
export function rowFor(step: StopId | null, lead?: Ask | null): Ask[] {
  const group = stepGroup(step);
  const ids = [...(group === 'any' ? [] : ROWS[group]), ...ROWS.any];
  const out: Ask[] = lead ? [lead] : [];
  for (const id of ids) {
    if (out.length >= ROW_MAX) break;
    const a = askById(id);
    if (a && !out.some((x) => x.id === a.id)) out.push(a);
  }
  return out;
}

/** The asks of a group, in its row's order first (⌘K's "For this step" and "Any step"). */
export function asksOf(group: AskGroup): Ask[] {
  const row = ROWS[group].map((id) => askById(id)).filter((a): a is Ask => Boolean(a));
  return [...row, ...ASKS.filter((a) => a.steps.includes(group) && !row.includes(a))];
}

/** The box's words with an ask's text added (after his own, on a new line), and where the gap is. */
export function fillGap(draft: string, text: string): { draft: string; cursor: number } {
  const at = Math.max(0, text.indexOf(GAP));
  const words = text.replace(GAP, '');
  const head = draft.trim() ? `${draft.replace(/\s+$/, '')}\n` : '';
  return { draft: `${head}${words}`, cursor: head.length + at };
}

/** How a hover says what an ask does, then its exact text. */
export function askSays(a: Pick<Ask, 'kind' | 'needsWord'>): string {
  if (a.kind === 'fast') return 'Not a message. Changes this job’s options:';
  return a.needsWord ? 'Puts in the box, for your word:' : 'Sends:';
}

// ---------- Go faster ----------

/** The options Go faster reads and changes (the rest of options.json goes back as it was). */
export interface FastOptions {
  reviewers?: string[] | 'auto';
  fable_checks?: string[];
  skip?: string[];
  [key: string]: unknown;
}

/**
 * The job's options made fast from the next step: one reviewer a round (the head reviewer; the
 * bug-fix lens on a bug job) and no second looks (no Fable checks). `says` names what it switched,
 * or is null when the job was already that fast.
 */
export function fastOptions<T extends FastOptions>(was: T, kind: 'feature' | 'bug' | string | null): { options: T; says: string | null } {
  const head = kind === 'bug' ? 'bug-review-fix' : 'feature-reviewer';
  const reviewSkipped = (was.skip ?? []).includes('review') || (Array.isArray(was.reviewers) && was.reviewers.length === 0);
  const cutReviewers = !reviewSkipped && !(Array.isArray(was.reviewers) && was.reviewers.length === 1);
  const cutLooks = (was.fable_checks ?? []).length > 0;
  const switched = [cutReviewers ? '1 reviewer' : null, cutLooks ? 'no second looks' : null].filter(Boolean);
  const options = { ...was, ...(cutReviewers ? { reviewers: [head] } : {}), ...(cutLooks ? { fable_checks: [] } : {}) };
  return { options, says: switched.length ? `Fast from the next step: ${switched.join(', ')}` : null };
}

// ---------- Kept asks (Yours) ----------

/** Where kept asks live: this browser (one user, one browser). */
export const KEPT_KEY = 'sb.asks.kept';

/** His kept asks, oldest first. */
export function keptAsks(): string[] {
  const raw = readStored(KEPT_KEY);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  } catch {
    return [];
  }
}

/** Keep a message he sent as an ask; false when it is kept already. */
export function keepAsk(text: string): boolean {
  const words = text.trim();
  if (!words) return false;
  const kept = keptAsks();
  if (kept.includes(words)) return false;
  writeStored(KEPT_KEY, JSON.stringify([...kept, words]));
  return true;
}

/** A kept ask as the palette lists and runs it. */
export function keptAsk(text: string, i: number): Ask {
  const label = text.length > 60 ? `${text.slice(0, 59)}…` : text;
  return { id: `kept-${i}`, label, text, steps: ['any'], inRow: false, needsWord: text.includes(GAP), kind: 'send' };
}
