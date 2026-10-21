// Hand-off nudges (plan §2 C): after the review, a job's PRs change hands (you, Raj, the release
// owner). Each hand-off is one Desk item with one key instead of a Foreman stage asking for a
// go-ahead. Worked out here from a card's facts, its flow lane and the finish line, and sent on
// every card as `nudges` (boardCard in server.js); the Desk (web/src/home/nudges.ts) lists them.
//
//   pr1-merge   PR #1 open from your fork          → "Self-review and merge PR #1 on GitHub" (a link)
//   pr2-open    PR #1 merged, no PR #2 yet         → "Open PR #2 to staging?" (yes asks the Foreman)
//   pr2-review  PR #2 open, no approval yet        → "Ask Raj for a review?" (yes asks the Foreman)
//   pr2-merge   PR #2 approved, not merged         → "Merge PR #2 on GitHub" (a link)
//
// The dashboard never merges or approves anything itself: a link nudge opens GitHub; an ask nudge
// sends one sentence to the job's Foreman, which does the git work as the skill's pr2 stage does.
// `afterLine` marks a nudge on a job past your finish line: the Desk lists those under a quieter
// Shipping heading at the end of its queue, never first. Dismissed ids (per job, in the dashboard's
// session record) are left out. Pure: nothing here reads a file or calls anything.

import { finishLineReached } from './finish.js';
import { STAGE_IDS } from './stages.js';

export const NUDGE_IDS = ['pr1-merge', 'pr2-open', 'pr2-review', 'pr2-merge'];

const prState = (p) => String(p?.state ?? '').toLowerCase();
// A draft isn't ready for anyone yet: no nudge until it is marked ready.
const isOpen = (p) => p !== null && prState(p) === 'open';
const isMerged = (p) => p !== null && prState(p) === 'merged';
const num = (p) => (Number.isInteger(p?.number) && p.number > 0 ? ` (#${p.number})` : '');

/**
 * PR #n as the map knows it (the lane's pr1/pr2), else as the job's status.json names it
 * (prs[n-1]: { number, url, state }); null when it hasn't been opened.
 */
function prOf(lane, prs, n) {
  const fromLane = n === 1 ? lane?.pr1 : lane?.pr2;
  if (fromLane) return fromLane;
  const s = Array.isArray(prs) ? prs[n - 1] : null;
  if (!s || !['open', 'draft', 'merged', 'closed'].includes(prState(s))) return null; // not_started: no PR
  return { number: s.number ?? null, url: s.url ?? null, state: prState(s), review: s.review ?? null, checks: s.checks ?? null };
}

/** Whether the job's stage is already past `stage` in the workflow (an unknown stage isn't). */
function pastStage(current, stage) {
  const i = STAGE_IDS.indexOf(current);
  return i >= 0 && i > STAGE_IDS.indexOf(stage);
}

/**
 * The nudges for one job.
 *   card     { stage, prs, closed, finish? } as boardCard has them (finish from finishLineReached;
 *            worked out here from `finishLine` when the card doesn't carry it)
 *   lane     the job's flow lane (flow.js laneOf), or null when the map doesn't know it
 *   finishLine  the setting (lib/finish.js), used only when the card has no `finish`
 *   dismissed   nudge ids you dismissed on this job
 * Each: { id, kind: 'link' | 'ask', title, text, link, action: { send } | null, afterLine }.
 */
export function nudgesFor(card, lane, { finishLine, dismissed = [] } = {}) {
  if (!card || card.closed?.as === 'dropped') return [];
  const pr1 = prOf(lane, card.prs, 1);
  const pr2 = prOf(lane, card.prs, 2);
  const finish = card.finish ?? finishLineReached(card, lane, finishLine);
  const afterLine = Boolean(finish?.reached);
  const out = [];
  const add = (id, kind, title, text, extra) => out.push({ id, kind, title, text, link: null, action: null, ...extra, afterLine });

  if (isOpen(pr1)) {
    const checks = pr1.checks === 'failing' ? ' Its checks are failing.' : '';
    add('pr1-merge', 'link', 'Self-review and merge PR #1 on GitHub',
      `PR #1${num(pr1)} is open from your fork to the Moxie branch. Read it over and merge it there; merges stay yours.${checks}`,
      { link: pr1.url ?? null });
  } else if (isMerged(pr1) && pr2 === null && !pastStage(card.stage, 'pr2') && (lane?.position ?? 'org') === 'org') {
    add('pr2-open', 'ask', 'Open PR #2 to staging?',
      'PR #1 is merged: your work is on the Moxie branch. Yes asks the Foreman to open PR #2 (Moxie branch → staging).',
      { action: { send: 'Please open PR #2 (org branch → staging).' } });
  }
  if (isOpen(pr2)) {
    if (pr2.review === 'approved') {
      add('pr2-merge', 'link', 'Merge PR #2 on GitHub',
        `Raj approved PR #2${num(pr2)}. Merge it on GitHub; the work lands in staging.`,
        { link: pr2.url ?? null });
    } else {
      add('pr2-review', 'ask', 'Ask Raj for a review?',
        `PR #2${num(pr2)} is open and has no approval yet. Yes asks the Foreman to request Raj’s review on it.`,
        { action: { send: 'Please request Raj’s review on PR #2.' } });
    }
  }
  const gone = new Set(Array.isArray(dismissed) ? dismissed : []);
  return out.filter((n) => !gone.has(n.id));
}
