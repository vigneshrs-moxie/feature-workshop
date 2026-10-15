// Which group a job sits in on the new UI's Jobs pane, worked out here so every page agrees.
//
//   needs-you  waiting for you: a permission or question card, or a brief waiting for your answer
//   running    the Foreman or a crew member is working on it right now
//   paused     stopped by a Claude usage limit, carrying on once it resets (only that: a reply you
//              stopped yourself leaves the job waiting for your next message, which is idle)
//   idle       nothing is happening and nothing is asked of you
//   done       finished, or marked done or dropped
//
// Takes a card as built for /api/features (boardCard in server.js).

export const GROUPS = ['needs-you', 'running', 'paused', 'idle', 'done'];

export function groupFor(card) {
  if (card.closed) return 'done'; // marked done or dropped, and nothing has happened since
  if (card.permissions > 0) return 'needs-you'; // a card is waiting for a click, even mid-reply
  if (card.working || card.starting) return 'running';
  if (card.limitPaused) return 'paused';
  if (card.needsYou) return 'needs-you';
  if (card.stageState === 'done') return 'done';
  return 'idle';
}

/** Cards with their group, in Jobs-pane order: by group, then as they came (already ranked). */
export function groupCards(cards) {
  return cards
    .map((c, i) => ({ c: { ...c, group: groupFor(c) }, i }))
    .sort((a, b) => GROUPS.indexOf(a.c.group) - GROUPS.indexOf(b.c.group) || a.i - b.i)
    .map((x) => x.c);
}
