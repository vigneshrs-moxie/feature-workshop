// Which group a job sits in on the new UI's Jobs pane, worked out here so every page agrees.
//
//   needs-you  waiting for you: a permission or question card, or a brief waiting for your answer
//   running    the Foreman or a crew member is working on it right now
//   paused     stopped by a Claude usage limit, carrying on once it resets (only that: a reply you
//              stopped yourself leaves the job waiting for your next message, which is idle)
//   idle       nothing is happening and nothing is asked of you
//   shipping   past the finish line you set (lib/finish.js) and on its way to main: nothing asks
//              you anything; the row says where it is
//   done       in main, marked done or dropped, or the Foreman's record says done
//
// A gate left waiting past the parking time (lib/gate.js) is not a group of its own: the card's
// `parked` flag is set and it stays under needs-you, so the ask isn't hidden (decision D3).
//
// Takes a card as built for /api/features (boardCard in server.js), with its `finish`
// (lib/finish.js finishLineReached: { reached, landed }).

export const GROUPS = ['needs-you', 'running', 'paused', 'idle', 'shipping', 'done'];

export function groupFor(card) {
  if (card.closed) return 'done'; // marked done or dropped, and nothing has happened since
  if (card.permissions > 0) return 'needs-you'; // a card is waiting for a click, even mid-reply
  if (card.working || card.starting) return 'running';
  if (card.limitPaused) return 'paused';
  if (card.needsYou) return 'needs-you';
  if (card.finish?.landed === 'main') return 'done'; // the real end, whatever the finish line
  if (card.finish?.reached) return 'shipping'; // past your finish line, waiting on other people
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
