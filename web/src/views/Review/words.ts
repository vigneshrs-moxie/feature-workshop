// The review round's pictures: an icon beside every kind and state (the words carry the meaning;
// the icon is never alone, and neither is a colour), and the round's three-card guide.
import type { ReviewItemKind, ReviewItemState, ReviewSendStep, ReviewState } from '../../api/types';
import type { IconName } from '../../components/Icon';
import type { GuideSpec } from '../../components/page/Page';

export const KIND_ICON: Record<ReviewItemKind, IconName> = { change: 'pencil', question: 'help', nit: 'minus', check: 'octagon' };
export const KIND_WORDS: Record<ReviewItemKind, string> = { change: 'Change', question: 'Question', nit: 'Nit', check: 'Check' };
/** What each kind means, for the kind menu. */
export const KIND_HINT: Record<ReviewItemKind, string> = {
  change: 'Asks for a change to the code.',
  question: 'Asks something: it gets an answer, not a commit.',
  nit: 'Small and optional.',
  check: 'A check that failed on the same commit: it gets no reply; the push runs it again.',
};

export const ITEM_ICON: Record<ReviewItemState, IconName> = {
  todo: 'circle', working: 'loader', fixed: 'circle-check', answered: 'message', wont_change: 'minus', left_out: 'circle-dashed',
};

export const STEP_ICON: Record<ReviewSendStep['state'], IconName> = {
  will: 'clock', working: 'loader', done: 'circle-check', stopped: 'x', 'not-run': 'minus', 'after-pr1': 'hourglass', skipped: 'skip',
};

/** The bar's look for each state: its icon, and whether it is a failure (drawn in the error colours, with the words saying so). */
export function barLook(state: ReviewState | null): { icon: IconName; tone: 'go' | 'quiet' | 'warn' | 'stop'; fail: boolean } {
  switch (state) {
    case 'asked': case 'left': return { icon: 'message', tone: 'go', fail: false };
    case 'new-comment': return { icon: 'plus', tone: 'go', fail: false };
    case 'ready': return { icon: 'send', tone: 'go', fail: false };
    case 'fixing': return { icon: 'hammer', tone: 'quiet', fail: false };
    case 'fix-stalled': return { icon: 'pause', tone: 'warn', fail: false };
    case 'sending': return { icon: 'send', tone: 'quiet', fail: false };
    case 'stopped': return { icon: 'x', tone: 'stop', fail: true };
    case 'check-failed': return { icon: 'x', tone: 'stop', fail: true };
    case 'conflicts': return { icon: 'merge', tone: 'stop', fail: true };
    case 'after-pr1': return { icon: 'hourglass', tone: 'quiet', fail: false };
    case 'waiting': return { icon: 'hourglass', tone: 'quiet', fail: false };
    case 'approval-reset': return { icon: 'undo', tone: 'quiet', fail: false };
    case 'no-reviewer': return { icon: 'user', tone: 'stop', fail: false };
    case 'closed': return { icon: 'x', tone: 'warn', fail: false };
    case 'approved-they-merge': return { icon: 'merge', tone: 'quiet', fail: false };
    case 'approved-you-merge': return { icon: 'merge', tone: 'go', fail: false };
    case 'merged': return { icon: 'circle-check', tone: 'quiet', fail: false };
    case 'held': return { icon: 'lock', tone: 'warn', fail: false };
    default: return { icon: 'git-pr', tone: 'quiet', fail: false };
  }
}

/** The Jobs card's icon for a review line: an hourglass while it waits, a turn-back for a reset approval. */
export function cardIcon(state: ReviewState | null): IconName {
  if (state === 'approval-reset') return 'undo';
  if (state === 'waiting' || state === 'approved-they-merge' || state === 'after-pr1') return 'hourglass';
  return barLook(state).icon;
}

/** The states whose items you can still tick, re-kind and add a note to (before the Foreman starts). */
export const EDITABLE = new Set<ReviewState>(['asked', 'left']);
/** The states that show the round's items at the top (the rest fold them under what is happening). */
export const ROUND_FIRST = new Set<ReviewState>(['asked', 'left', 'fixing', 'fix-stalled', 'new-comment', 'check-failed']);

export const REVIEW_GUIDE: GuideSpec = {
  id: 'review-round',
  title: 'How review rounds work',
  done: 'Show me the round',
  cards: [
    { icons: ['message', 'list'], title: 'A round is one review', say: 'Everything a reviewer asked for in one go, plus a check that failed on the same commit, is one round.' },
    { icons: ['hand', 'hammer'], title: 'One yes fixes it', say: 'The Foreman says what it will do with each item, then fixes, commits and drafts a reply to each. Nothing goes to GitHub yet.' },
    { icons: ['send', 'hourglass'], title: 'One go sends it back', say: 'Every step is listed before the button: push, replies, ask the reviewer again. Then the job waits, and GitHub is checked every minute.' },
  ],
};
