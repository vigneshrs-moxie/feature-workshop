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

// ---------- The four lanes of Jobs (plan §7, packet M) ----------
//
//   working    running: the Foreman or a crew member is at it (a usage-limit pause stays here, with
//              `paused` set and when it carries on)
//   needs-you  something waits for you: a go-ahead, an answer, a permission, a crew question, a PR
//              feedback card, a stuck stack part, or changes asked for on a PR
//   in-review  a PR is open and waits on other people (a review, its checks), or the work is past
//              your finish line on its way to main
//   ready      a PR's checks passed and its approvals are in: merging is the next step
// and two folded under the board: resting (nothing happening, nothing asked) and done.
//
// laneFor(card, { lane, pending }) → { lane, laneReason, paused? }. card: as boardCard builds it;
// lane: the job's flow lane (lib/flow.js laneOf: pr1, pr2 with state, review and checks), if known;
// pending: the job's pending permission and question cards (driver.pendingPermissions()). Every
// reason is a plain sentence the card shows, so the lane is never told by its colour alone.

export const LANES = ['working', 'needs-you', 'in-review', 'ready', 'resting', 'done'];

const STAGE_WORDS = {
  clarify: 'the questions', spec: 'the spec', refine: 'the spec', wireframe: 'the screens', investigate: 'the findings',
  'spec-update': 'the spec update', plan: 'the plan', implement: 'the build', test: 'the tests', review: 'the review',
  pr1: 'PR #1', pr2: 'PR #2', 'staging-qa': 'staging', pr3: 'PR #3',
};
const isOpen = (pr) => pr && (pr.state === 'open' || pr.state === 'draft');
const many = (n, one, more) => (n === 1 ? one : more.replace('{n}', String(n)));

function clock(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The newest open PR of the job, as { n, pr }: PR #2 before PR #1. */
function openPr(lane) {
  if (isOpen(lane?.pr2)) return { n: 2, pr: lane.pr2 };
  if (isOpen(lane?.pr1)) return { n: 1, pr: lane.pr1 };
  return null;
}

export function laneFor(card, { lane = null, pending = [] } = {}) {
  const needs = (laneReason) => ({ lane: 'needs-you', laneReason });
  if (card.closed) return { lane: 'done', laneReason: card.closed.as === 'dropped' ? 'Dropped' : 'Marked done' };

  // Cards waiting for a click: permissions, a crew member's question, PR feedback.
  const cards = pending.length ? pending : Array.from({ length: Number(card.permissions) || 0 }, () => ({}));
  if (cards.length) {
    // A review round's card (packet Q, lib/driver.js parkRoundCard) says what the reviewer asked for.
    const round = cards.find((p) => p.roundCard);
    const feedback = cards.filter((p) => p.feedbackCard).length;
    const questions = cards.filter((p) => p.kind === 'question' && !p.feedbackCard && !p.roundCard).length;
    const asks = cards.length - feedback - questions - (round ? cards.filter((p) => p.roundCard).length : 0);
    if (asks) return needs(many(asks, 'A permission waits for your yes', '{n} permissions wait for your yes'));
    if (round && !questions && !feedback) return needs(round.plain?.headline || 'A review round waits for your go');
    if (questions) return needs(many(questions, 'A crew member asked you something', 'The crew asked you {n} things'));
    return needs(many(feedback, 'A PR feedback card waits for you', '{n} PR feedback cards wait for you'));
  }
  // A stack part that failed its checks three times stops and needs you (lib/stack.js).
  if (card.stuck) return needs(`${card.stuck} is stuck and needs you`);

  if (card.working || card.starting) {
    const doing = (Array.isArray(card.nowDoing) ? card.nowDoing : []).find((d) => d?.doing)?.doing;
    return { lane: 'working', laneReason: doing ? String(doing) : card.starting ? 'Starting the job' : 'The crew is at work' };
  }
  if (card.limitPaused) {
    const at = clock(card.limitPaused);
    return { lane: 'working', paused: true, laneReason: at ? `Paused for the usage limit; carries on at ${at}` : 'Paused for the usage limit; carries on when it resets' };
  }
  if (card.restartPaused) {
    return { lane: 'working', paused: true, laneReason: card.restartPaused.how === 'crash' ? 'Paused by a restart; waits for Resume' : 'Paused by a restart; carries on by itself' };
  }

  if (card.needsYou) {
    const on = STAGE_WORDS[card.stage] ?? null;
    if (card.waitingFor === 'answers') return needs('The Foreman asked you something');
    if (card.waitingFor === 'approval') return needs(on ? `Waiting for your go-ahead on ${on}` : 'Waiting for your go-ahead');
    return needs('Waiting for your reply');
  }

  if (card.finish?.landed === 'main') return { lane: 'done', laneReason: 'In main' };

  const open = openPr(lane);
  if (open) {
    const { n, pr } = open;
    if (pr.review === 'changes_requested') return needs(`Changes were asked for on PR #${n}`);
    if (pr.checks === 'failing') return { lane: 'in-review', laneReason: `PR #${n}’s checks are failing` };
    // PR #1 is yours to self-review: green checks are enough. Later PRs need their approval too.
    const approved = pr.review === 'approved' || (n === 1 && pr.review !== 'review_required');
    if (pr.state !== 'draft' && pr.checks !== 'pending' && approved) {
      return { lane: 'ready', laneReason: pr.checks === 'passing' ? `Checks passed and PR #${n} is approved` : `PR #${n} is approved` };
    }
    if (pr.state === 'draft') return { lane: 'in-review', laneReason: `PR #${n} is a draft` };
    if (pr.checks === 'pending') return { lane: 'in-review', laneReason: `PR #${n}’s checks are running` };
    return { lane: 'in-review', laneReason: `PR #${n} is open, waiting on a review` };
  }
  if (card.finish?.reached) {
    return { lane: 'in-review', laneReason: card.finish.landed === 'staging' ? 'In staging, on its way to main' : 'Past your finish line, on its way to main' };
  }
  if (card.stageState === 'done') return { lane: 'done', laneReason: 'Done' };
  if (card.paused) return { lane: 'resting', laneReason: 'Stopped; waits for your next message' };
  return { lane: 'resting', laneReason: 'Nothing happening; waits for your next message' };
}
